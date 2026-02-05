import { Command } from 'commander';
import { prisma } from '@ilr/db';
import { runScraper, gracefulShutdown } from './scraper/runner.js';
import { getSourceAdapter } from './sources/index.js';

const program = new Command();

// Graceful shutdown handling
let isShuttingDown = false;

const handleShutdown = async (signal: string) => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  
  console.log(`\n${signal} received. Gracefully shutting down...`);
  
  try {
    await gracefulShutdown();
    console.log('Shutdown complete.');
    process.exit(0);
  } catch (error) {
    console.error('Error during shutdown:', error);
    process.exit(1);
  }
};

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

program
  .name('ilr-worker')
  .description('ILR Tracker scraper worker')
  .version('0.0.1');

program
  .command('run')
  .description('Run the scraper for a specific source')
  .requiredOption('-s, --source <name>', 'Source name to scrape')
  .option('--since <date>', 'Only scrape content since this date (ISO format)')
  .option('--max-threads <n>', 'Maximum number of threads to scrape', parseInt)
  .option('--dry-run', 'Run without saving to database')
  .option('--no-resume', 'Start from page 1 instead of resuming from last scraped page')
  .action(async (options) => {
    const { source: sourceName, since, maxThreads, dryRun, resume } = options;

    console.log(`Starting scraper for source: ${sourceName}`);
    console.log(`Options: since=${since || 'all'}, maxThreads=${maxThreads || 'unlimited'}, dryRun=${dryRun || false}, resume=${resume}`);

    try {
      // Get source from database
      const source = await prisma.sourceForum.findUnique({
        where: { name: sourceName },
      });

      if (!source) {
        console.error(`Source not found: ${sourceName}`);
        process.exit(1);
      }

      if (!source.isActive) {
        console.warn(`Source is not active: ${sourceName}`);
      }

      // Get the adapter for this source
      const adapter = getSourceAdapter(source);
      if (!adapter) {
        console.error(`No adapter found for source type: ${source.name}`);
        process.exit(1);
      }

      // Run the scraper
      await runScraper({
        source,
        adapter,
        since: since ? new Date(since) : undefined,
        maxThreads,
        dryRun: dryRun || false,
        resume: resume !== false, // Default true, false if --no-resume passed
      });

      console.log('Scraper completed successfully');
    } catch (error) {
      console.error('Scraper failed:', error);
      process.exit(1);
    } finally {
      await prisma.$disconnect();
    }
  });

program
  .command('list-sources')
  .description('List all configured sources')
  .action(async () => {
    const sources = await prisma.sourceForum.findMany({
      select: {
        name: true,
        displayName: true,
        type: true,
        isActive: true,
        _count: { select: { threads: true } },
      },
    });

    console.log('\nConfigured sources:');
    console.log('-------------------');
    for (const source of sources) {
      const status = source.isActive ? '✓' : '✗';
      console.log(`${status} ${source.name} (${source.displayName})`);
      console.log(`  Type: ${source.type}, Threads: ${source._count.threads}`);
    }
    console.log();

    await prisma.$disconnect();
  });

program
  .command('scheduled')
  .description('Run scheduled scrape for all active sources')
  .action(async () => {
    console.log('Starting scheduled scrape for all active sources...');

    const sources = await prisma.sourceForum.findMany({
      where: { isActive: true },
    });

    console.log(`Found ${sources.length} active sources`);

    for (const source of sources) {
      console.log(`\nProcessing source: ${source.displayName}`);
      
      const adapter = getSourceAdapter(source);
      if (!adapter) {
        console.warn(`No adapter for source: ${source.name}, skipping`);
        continue;
      }

      try {
        await runScraper({
          source,
          adapter,
          // For scheduled runs, default to last 24 hours
          since: new Date(Date.now() - 24 * 60 * 60 * 1000),
          dryRun: false,
        });
      } catch (error) {
        console.error(`Error scraping ${source.name}:`, error);
        // Continue with other sources
      }
    }

    console.log('\nScheduled scrape completed');
    await prisma.$disconnect();
  });

program.parse();
