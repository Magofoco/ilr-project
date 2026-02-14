import { Command } from 'commander';
import { prisma } from '@ilr/db';
import { runScraper, gracefulShutdown } from './scraper/runner.js';
import { getSourceAdapter, listAvailableAdapters } from './sources/index.js';

// ============================================
// ENVIRONMENT VALIDATION
// ============================================

const requiredEnvVars = ['DATABASE_URL'] as const;
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`Missing required environment variable: ${envVar}`);
    console.error('Ensure your .env file is loaded or the variable is set.');
    process.exit(1);
  }
}

// ============================================
// CLI SETUP
// ============================================

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

// Handle uncaught errors
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
  handleShutdown('unhandledRejection');
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  handleShutdown('uncaughtException');
});

program
  .name('ilr-worker')
  .description('ILR Tracker scraper worker')
  .version('0.1.0');

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

    console.log(`\n========================================`);
    console.log(`ILR Worker - Scrape Run`);
    console.log(`========================================`);
    console.log(`Source:     ${sourceName}`);
    console.log(`Since:      ${since || 'all time'}`);
    console.log(`Max threads: ${maxThreads || 'unlimited'}`);
    console.log(`Dry run:    ${dryRun || false}`);
    console.log(`Resume:     ${resume}`);
    console.log(`========================================\n`);

    // Validate --since date
    if (since) {
      const parsed = new Date(since);
      if (isNaN(parsed.getTime())) {
        console.error(`Invalid --since date: "${since}". Use ISO format (e.g., 2025-01-01)`);
        process.exit(1);
      }
    }

    try {
      // Verify database connection
      await prisma.$queryRaw`SELECT 1`;
      
      // Get source from database
      const source = await prisma.sourceForum.findUnique({
        where: { name: sourceName },
      });

      if (!source) {
        const available = listAvailableAdapters();
        console.error(`Source not found: "${sourceName}"`);
        console.error(`Available adapters: ${available.join(', ')}`);
        console.error(`\nMake sure to run the seed first: pnpm --filter @ilr/worker run seed`);
        process.exit(1);
      }

      if (!source.isActive) {
        console.warn(`Warning: Source "${sourceName}" is not active. Running anyway...`);
      }

      // Get the adapter for this source
      const adapter = getSourceAdapter(source);
      if (!adapter) {
        const available = listAvailableAdapters();
        console.error(`No adapter found for source: "${source.name}"`);
        console.error(`Available adapters: ${available.join(', ')}`);
        process.exit(1);
      }

      // Run the scraper
      await runScraper({
        source,
        adapter,
        since: since ? new Date(since) : undefined,
        maxThreads,
        dryRun: dryRun || false,
        resume: resume !== false,
      });

      console.log('\nScraper completed successfully');
    } catch (error) {
      console.error('\nScraper failed:', error instanceof Error ? error.message : error);
      process.exit(1);
    } finally {
      await prisma.$disconnect();
    }
  });

program
  .command('list-sources')
  .description('List all configured sources and their scrape status')
  .action(async () => {
    try {
      const sources = await prisma.sourceForum.findMany({
        select: {
          name: true,
          displayName: true,
          type: true,
          isActive: true,
          _count: { select: { threads: true } },
        },
      });

      const adapters = listAvailableAdapters();

      console.log('\nConfigured sources:');
      console.log('-------------------');
      if (sources.length === 0) {
        console.log('  (none — run seed first)');
      }
      for (const source of sources) {
        const status = source.isActive ? 'active' : 'inactive';
        const hasAdapter = adapters.includes(source.name) ? 'adapter found' : 'NO ADAPTER';
        console.log(`  ${source.isActive ? '✓' : '✗'} ${source.name} (${source.displayName})`);
        console.log(`    Type: ${source.type} | Status: ${status} | Threads: ${source._count.threads} | ${hasAdapter}`);
      }

      console.log(`\nAvailable adapters: ${adapters.join(', ')}`);
      console.log();
    } catch (error) {
      console.error('Failed to list sources:', error instanceof Error ? error.message : error);
      process.exit(1);
    } finally {
      await prisma.$disconnect();
    }
  });

program
  .command('scheduled')
  .description('Run scheduled scrape for all active sources (used by CI/cron)')
  .action(async () => {
    console.log('Starting scheduled scrape for all active sources...');
    console.log(`Timestamp: ${new Date().toISOString()}\n`);

    let hadErrors = false;

    try {
      const sources = await prisma.sourceForum.findMany({
        where: { isActive: true },
      });

      console.log(`Found ${sources.length} active source(s)`);

      if (sources.length === 0) {
        console.log('No active sources to scrape. Exiting.');
        return;
      }

      for (const source of sources) {
        if (isShuttingDown) break;

        console.log(`\n--- Processing source: ${source.displayName} ---`);
        
        const adapter = getSourceAdapter(source);
        if (!adapter) {
          console.warn(`No adapter for source: ${source.name}, skipping`);
          hadErrors = true;
          continue;
        }

        try {
          await runScraper({
            source,
            adapter,
            since: new Date(Date.now() - 24 * 60 * 60 * 1000),
            dryRun: false,
          });
        } catch (error) {
          console.error(`Error scraping ${source.name}:`, error instanceof Error ? error.message : error);
          hadErrors = true;
        }
      }

      console.log(`\nScheduled scrape completed${hadErrors ? ' (with errors)' : ''}`);
    } catch (error) {
      console.error('Scheduled scrape failed:', error instanceof Error ? error.message : error);
      process.exit(1);
    } finally {
      await prisma.$disconnect();
    }

    // Exit with error code if any source failed (useful for CI alerts)
    if (hadErrors) {
      process.exit(1);
    }
  });

program.parse();
