import { prisma, Prisma, type SourceForum } from '@ilr/db';
import type { SourceAdapter, ScrapedPost, ScrapeProgress } from '@ilr/shared';
import { retryWithBackoff } from '@ilr/shared';
import { extractCaseData, EXTRACTOR_VERSION } from '../extraction/extractor.js';
import { hashContent, delay, getJitter } from '../utils/helpers.js';

interface RunScraperOptions {
  source: SourceForum;
  adapter: SourceAdapter;
  since?: Date;
  maxThreads?: number;
  dryRun: boolean;
  resume?: boolean;
}

// Batch size for database operations
const BATCH_SIZE = 50;

// Pages to process before saving to DB (chunked processing)
const PAGES_PER_CHUNK = 10;

// Memory warning threshold (500 MB)
const MEMORY_WARNING_MB = 500;

interface PostWithHash extends ScrapedPost {
  contentHash: string;
}

// Track current scrape run for graceful shutdown
let currentScrapeRunId: string | null = null;
let currentAdapter: SourceAdapter | null = null;
let shutdownRequested = false;

/**
 * Log memory usage if it exceeds the warning threshold.
 */
function checkMemory(label: string): void {
  const usage = process.memoryUsage();
  const heapMB = Math.round(usage.heapUsed / 1024 / 1024);
  if (heapMB > MEMORY_WARNING_MB) {
    console.warn(`  [MEMORY WARNING] ${label}: Heap ${heapMB}MB (RSS ${Math.round(usage.rss / 1024 / 1024)}MB)`);
  }
}

/**
 * Format seconds into human-readable duration
 */
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${mins}m`;
}

/**
 * Graceful shutdown handler - called when SIGINT/SIGTERM received
 */
export async function gracefulShutdown(): Promise<void> {
  shutdownRequested = true;
  
  if (currentScrapeRunId) {
    try {
      await prisma.scrapeRun.update({
        where: { id: currentScrapeRunId },
        data: {
          status: 'failed',
          completedAt: new Date(),
          errorMessage: 'Graceful shutdown requested',
        },
      });
      console.log('  Marked scrape run as failed due to shutdown');
    } catch (error) {
      console.error('  Error updating scrape run:', error);
    }
  }
  
  if (currentAdapter?.cleanup) {
    try {
      await currentAdapter.cleanup();
      console.log('  Cleaned up browser resources');
    } catch (error) {
      console.error('  Error cleaning up adapter:', error);
    }
  }
  
  await prisma.$disconnect();
}

function shouldStop(): boolean {
  return shutdownRequested;
}

export async function runScraper(options: RunScraperOptions): Promise<void> {
  const { source, adapter, since, maxThreads, dryRun, resume = true } = options;
  const runStartTime = Date.now();

  // Debug: verify DB connection goes where we expect
  const dbCheck = await prisma.$queryRaw<Array<{ current_database: string; post_count: bigint }>>`
    SELECT current_database(), (SELECT COUNT(*) FROM posts) as post_count
  `;
  console.log(`DB check: database=${dbCheck[0]?.current_database}, existing posts=${dbCheck[0]?.post_count}`);
  console.log(`DATABASE_URL=${process.env.DATABASE_URL?.replace(/:[^@]*@/, ':***@')}`);

  // Reset shutdown flag
  shutdownRequested = false;
  currentAdapter = adapter;

  // Create scrape run record
  const scrapeRun = dryRun
    ? null
    : await prisma.scrapeRun.create({
        data: {
          sourceId: source.id,
          status: 'running',
          runConfig: {
            since: since?.toISOString(),
            maxThreads,
            resume,
            extractorVersion: EXTRACTOR_VERSION,
          },
        },
      });

  currentScrapeRunId = scrapeRun?.id || null;

  const stats = {
    threadsFound: 0,
    threadsScraped: 0,
    postsFound: 0,
    postsScraped: 0,
    casesExtracted: 0,
  };

  try {
    // Step 1: Get threads to scrape
    console.log('Fetching thread list...');
    const threads = await adapter.getThreads({ since, maxThreads });
    stats.threadsFound = threads.length;
    console.log(`Found ${threads.length} thread(s)`);

    // Step 2: Process each thread
    for (let i = 0; i < threads.length; i++) {
      if (shouldStop()) {
        console.log('Shutdown requested, stopping...');
        break;
      }

      const thread = threads[i]!;
      const threadStartTime = Date.now();
      console.log(`\n[${i + 1}/${threads.length}] Processing: ${thread.title.slice(0, 60)}...`);

      try {
        // Rate limiting with jitter (skip for the first thread)
        if (i > 0) {
          await delay(getJitter());
        }

        // Get or create thread in DB
        const dbThread = dryRun
          ? null
          : await retryWithBackoff(
              () => prisma.thread.upsert({
                where: {
                  sourceId_externalId: {
                    sourceId: source.id,
                    externalId: thread.externalId,
                  },
                },
                create: {
                  sourceId: source.id,
                  externalId: thread.externalId,
                  url: thread.url,
                  title: thread.title,
                  authorName: thread.authorName,
                  postedAt: thread.postedAt,
                },
                update: {
                  title: thread.title,
                  lastScrapedAt: new Date(),
                },
              }),
              {
                maxAttempts: 3,
                onRetry: (attempt, error) => {
                  console.log(`    DB retry ${attempt}/3: ${error.message}`);
                },
              }
            );

        // Determine starting page for resume
        let startFromPage = 1;
        if (resume && dbThread?.lastScrapedPage && dbThread.lastScrapedPage > 0) {
          startFromPage = dbThread.lastScrapedPage;
          console.log(`  Resuming from page ${startFromPage}`);
        }

        // Step 3: Scrape posts with streaming — each page is written to DB as it arrives
        let allPostsProcessed = 0;
        let allCasesExtracted = 0;

        const { totalPosts, progress } = await adapter.getPosts(thread, {
          startFromPage,

          // Called for each page's posts — persist to DB immediately
          onPageData: async (pagePosts, pageNum) => {
            if (shouldStop()) {
              throw new Error('Shutdown requested');
            }

            if (dryRun) {
              for (const post of pagePosts) {
                const extraction = extractCaseData(post.content);
                if (extraction.confidence > 0.3) {
                  console.log(`    [DRY RUN] Would extract: ${extraction.applicationRoute || 'unknown route'} (${(extraction.confidence * 100).toFixed(0)}%)`);
                  stats.casesExtracted++;
                }
                stats.postsScraped++;
              }
            } else if (dbThread) {
              const result = await processPostsInBatches(dbThread.id, pagePosts);
              allPostsProcessed += result.postsProcessed;
              allCasesExtracted += result.casesExtracted;
            }

            stats.postsFound += pagePosts.length;
          },

          // Called with progress for saving resume state
          onProgress: async (prog: ScrapeProgress) => {
            if (!dryRun && dbThread && prog.lastScrapedPage % PAGES_PER_CHUNK === 0) {
              await retryWithBackoff(
                () => prisma.thread.update({
                  where: { id: dbThread.id },
                  data: {
                    lastScrapedPage: prog.lastScrapedPage,
                    totalPages: prog.totalPages,
                  },
                }),
                { maxAttempts: 2 }
              );
            }
            
            if (shouldStop()) {
              throw new Error('Shutdown requested');
            }
          },
        });

        if (!dryRun) {
          stats.postsScraped += allPostsProcessed;
          stats.casesExtracted += allCasesExtracted;
        }

        const threadElapsed = (Date.now() - threadStartTime) / 1000;
        console.log(`  Thread complete: ${totalPosts} posts scraped, ${allPostsProcessed} processed, ${allCasesExtracted} cases in ${formatDuration(threadElapsed)}`);

        // Update final progress
        if (!dryRun && dbThread && !shouldStop()) {
          await retryWithBackoff(
            () => prisma.thread.update({
              where: { id: dbThread.id },
              data: {
                lastScrapedPage: progress.lastScrapedPage,
                totalPages: progress.totalPages,
                lastScrapedAt: new Date(),
              },
            }),
            { maxAttempts: 2 }
          );
        }

        stats.threadsScraped++;
      } catch (error) {
        if (shouldStop()) {
          console.log('  Stopped due to shutdown request');
          break;
        }
        console.error(`  Error processing thread ${thread.externalId}:`, error instanceof Error ? error.message : error);
      }
    }

    // Cleanup adapter resources
    if (adapter.cleanup) {
      await adapter.cleanup();
    }
    currentAdapter = null;

    // Update scrape run with success/partial success
    if (scrapeRun) {
      await prisma.scrapeRun.update({
        where: { id: scrapeRun.id },
        data: {
          status: shouldStop() ? 'failed' : 'completed',
          completedAt: new Date(),
          errorMessage: shouldStop() ? 'Stopped by user' : undefined,
          ...stats,
        },
      });
    }
    currentScrapeRunId = null;

    const totalElapsed = (Date.now() - runStartTime) / 1000;
    console.log(`\nScrape complete in ${formatDuration(totalElapsed)}`);
    console.log('Stats:', JSON.stringify(stats, null, 2));
  } catch (error) {
    // Cleanup adapter resources on error
    if (adapter.cleanup) {
      try {
        await adapter.cleanup();
      } catch {
        // Ignore cleanup errors
      }
    }
    currentAdapter = null;

    // Update scrape run with failure
    if (scrapeRun) {
      try {
        await prisma.scrapeRun.update({
          where: { id: scrapeRun.id },
          data: {
            status: 'failed',
            completedAt: new Date(),
            errorMessage: error instanceof Error ? error.message : 'Unknown error',
            errorDetails: error instanceof Error ? { stack: error.stack } : {},
            ...stats,
          },
        });
      } catch (updateError) {
        console.error('  Failed to update scrape run status:', updateError);
      }
    }
    currentScrapeRunId = null;
    
    throw error;
  }
}

/**
 * Process posts in batches for better performance.
 * Handles deduplication via content hashing, and extracts case data for new/changed posts.
 */
async function processPostsInBatches(
  threadId: string,
  posts: ScrapedPost[]
): Promise<{ postsProcessed: number; casesExtracted: number }> {
  let postsProcessed = 0;
  let casesExtracted = 0;

  // Add content hashes to posts
  const postsWithHashes: PostWithHash[] = posts.map((post) => ({
    ...post,
    contentHash: hashContent(post.content),
  }));

  // Get existing posts to check for changes (with retry)
  const existingPosts = await retryWithBackoff(
    () => prisma.post.findMany({
      where: {
        threadId,
        externalId: { in: posts.map((p) => p.externalId) },
      },
      select: {
        id: true,
        externalId: true,
        contentHash: true,
      },
    }),
    { maxAttempts: 3 }
  );

  const existingPostMap = new Map(
    existingPosts.map((p) => [p.externalId, p])
  );

  // Separate posts into new, changed, and unchanged
  const newPosts: PostWithHash[] = [];
  const changedPosts: PostWithHash[] = [];

  for (const post of postsWithHashes) {
    const existing = existingPostMap.get(post.externalId);
    if (!existing) {
      newPosts.push(post);
    } else if (existing.contentHash !== post.contentHash) {
      changedPosts.push(post);
    }
  }

  const unchangedCount = posts.length - newPosts.length - changedPosts.length;
  console.log(`    New: ${newPosts.length}, Changed: ${changedPosts.length}, Unchanged: ${unchangedCount}`);

  // Process new posts in batches with retry
  for (let i = 0; i < newPosts.length; i += BATCH_SIZE) {
    if (shutdownRequested) break;
    
    const batch = newPosts.slice(i, i + BATCH_SIZE);
    
    await retryWithBackoff(
      () => prisma.$transaction(async (tx) => {
        // Insert new posts
        await tx.post.createMany({
          data: batch.map((post) => ({
            threadId,
            externalId: post.externalId,
            authorName: post.authorName,
            content: post.content,
            contentHash: post.contentHash,
            postedAt: post.postedAt,
            pageNumber: post.pageNumber,
          })),
          skipDuplicates: true,
        });

        // Get the created posts to extract cases
        const createdPosts = await tx.post.findMany({
          where: {
            threadId,
            externalId: { in: batch.map((p) => p.externalId) },
          },
          select: { id: true, externalId: true, content: true },
        });

        // Extract cases and prepare for batch insert
        const casesToCreate: Prisma.ExtractedCaseCreateManyInput[] = [];
        
        for (const dbPost of createdPosts) {
          const extraction = extractCaseData(dbPost.content);
          if (extraction.confidence > 0.3) {
            casesToCreate.push({
              postId: dbPost.id,
              applicationType: extraction.applicationType,
              applicationRoute: extraction.applicationRoute,
              applicationDate: extraction.applicationDate,
              biometricsDate: extraction.biometricsDate,
              decisionDate: extraction.decisionDate,
              waitingDays: extraction.waitingDays,
              serviceCenter: extraction.serviceCenter,
              applicantLocation: extraction.applicantLocation,
              outcome: extraction.outcome,
              confidence: extraction.confidence,
              extractionNotes: extraction.extractionNotes,
              extractorVersion: EXTRACTOR_VERSION,
            });
          }
        }

        if (casesToCreate.length > 0) {
          await tx.extractedCase.createMany({
            data: casesToCreate,
            skipDuplicates: true,
          });
          casesExtracted += casesToCreate.length;
        }
      }),
      {
        maxAttempts: 3,
        onRetry: (attempt, error) => {
          console.log(`    DB batch retry ${attempt}/3: ${error.message}`);
        },
      }
    );

    postsProcessed += batch.length;
  }

  // Process changed posts (updates) with retry
  for (const post of changedPosts) {
    if (shutdownRequested) break;
    
    const existing = existingPostMap.get(post.externalId);
    if (!existing) continue;

    await retryWithBackoff(
      () => prisma.$transaction(async (tx) => {
        await tx.post.update({
          where: { id: existing.id },
          data: {
            content: post.content,
            contentHash: post.contentHash,
            scrapedAt: new Date(),
            pageNumber: post.pageNumber,
          },
        });

        const extraction = extractCaseData(post.content);
        if (extraction.confidence > 0.3) {
          await tx.extractedCase.upsert({
            where: { postId: existing.id },
            create: {
              postId: existing.id,
              applicationType: extraction.applicationType,
              applicationRoute: extraction.applicationRoute,
              applicationDate: extraction.applicationDate,
              biometricsDate: extraction.biometricsDate,
              decisionDate: extraction.decisionDate,
              waitingDays: extraction.waitingDays,
              serviceCenter: extraction.serviceCenter,
              applicantLocation: extraction.applicantLocation,
              outcome: extraction.outcome,
              confidence: extraction.confidence,
              extractionNotes: extraction.extractionNotes,
              extractorVersion: EXTRACTOR_VERSION,
            },
            update: {
              applicationType: extraction.applicationType,
              applicationRoute: extraction.applicationRoute,
              applicationDate: extraction.applicationDate,
              biometricsDate: extraction.biometricsDate,
              decisionDate: extraction.decisionDate,
              waitingDays: extraction.waitingDays,
              serviceCenter: extraction.serviceCenter,
              applicantLocation: extraction.applicantLocation,
              outcome: extraction.outcome,
              confidence: extraction.confidence,
              extractionNotes: extraction.extractionNotes,
              extractorVersion: EXTRACTOR_VERSION,
              extractedAt: new Date(),
            },
          });
          casesExtracted++;
        }
      }),
      {
        maxAttempts: 3,
        onRetry: (attempt, error) => {
          console.log(`    DB update retry ${attempt}/3: ${error.message}`);
        },
      }
    );

    postsProcessed++;
  }

  return { postsProcessed, casesExtracted };
}
