import { prisma, type SourceForum } from '@ilr/db';
import type { SourceAdapter, ScrapedPost, ScrapeProgress } from '@ilr/shared';
import { retryWithBackoff } from '@ilr/shared';
import { extractCaseData, EXTRACTOR_VERSION } from '../extraction/extractor.js';
import { caseDataFromExtraction, syncCaseEvents } from '../extraction/persistence.js';
import { hashContent, delay, getJitter } from '../utils/helpers.js';

/** Minimum confidence for an extracted case to be persisted. */
const MIN_CONFIDENCE = 0.3;

interface RunScraperOptions {
  source: SourceForum;
  adapter: SourceAdapter;
  since?: Date;
  maxThreads?: number;
  /** Cap pages per thread (useful for smoke testing the scraper). */
  maxPages?: number;
  /** Explicit starting page (overrides resume). Use to jump into recent pages
   *  of an old thread instead of re-scraping the start. */
  fromPage?: number;
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
  const { source, adapter, since, maxThreads, maxPages, fromPage, dryRun, resume = true } = options;
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

  // Set to true if any thread aborts mid-scrape (e.g. consecutive page
  // failures). Drives the final scrape_run status: 'partial' instead of
  // 'completed' so we don't silently report success on a half-finished run.
  let anyAborted = false;

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

        // Determine starting page. --from-page wins over both resume state and default.
        let startFromPage = 1;
        if (fromPage && fromPage > 0) {
          startFromPage = fromPage;
          console.log(`  Starting from page ${startFromPage} (--from-page override)`);
        } else if (resume && dbThread?.lastScrapedPage && dbThread.lastScrapedPage > 0) {
          startFromPage = dbThread.lastScrapedPage;
          console.log(`  Resuming from page ${startFromPage}`);
        }

        // Step 3: Scrape posts with streaming — each page is written to DB as it arrives
        let allPostsProcessed = 0;
        let allCasesExtracted = 0;

        const { totalPosts, progress, aborted } = await adapter.getPosts(thread, {
          startFromPage,
          maxPages,

          // Called for each page's posts — persist to DB immediately
          onPageData: async (pagePosts, pageNum) => {
            if (shouldStop()) {
              throw new Error('Shutdown requested');
            }

            if (dryRun) {
              for (const post of pagePosts) {
                const extraction = extractCaseData(post.content, post.authorNationality);
                if (extraction.confidence >= MIN_CONFIDENCE) {
                  console.log(`    [DRY RUN] Would extract: ${extraction.applicationRoute || 'unknown route'} (${(extraction.confidence * 100).toFixed(0)}%, ${extraction.events.length} events)`);
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

        if (aborted) {
          anyAborted = true;
        }

        const threadElapsed = (Date.now() - threadStartTime) / 1000;
        console.log(
          `  Thread complete: ${totalPosts} posts scraped, ${allPostsProcessed} processed, ${allCasesExtracted} cases in ${formatDuration(threadElapsed)}` +
          (aborted ? ` (PARTIAL: stopped at page ${progress.lastScrapedPage}/${progress.totalPages})` : '')
        );

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
        // Treat a thrown thread as a partial run, not a silent success.
        // The runner used to log the error and continue to mark the overall
        // run 'completed', which made it impossible to tell from
        // scrape_runs.status whether the corpus had been refreshed.
        anyAborted = true;
        console.error(`  Error processing thread ${thread.externalId}:`, error instanceof Error ? error.message : error);
      }
    }

    // Cleanup adapter resources
    if (adapter.cleanup) {
      await adapter.cleanup();
    }
    currentAdapter = null;

    // Update scrape run with terminal status.
    // - 'failed'    : user-requested shutdown (SIGINT/SIGTERM)
    // - 'partial'   : at least one thread aborted (e.g. consecutive page
    //                 failures) — data persisted but coverage is incomplete
    // - 'completed' : all threads finished naturally
    const finalStatus = shouldStop() ? 'failed' : anyAborted ? 'partial' : 'completed';
    const finalErrorMessage = shouldStop()
      ? 'Stopped by user'
      : anyAborted
        ? 'Aborted early on one or more threads (see worker logs)'
        : undefined;
    if (scrapeRun) {
      await prisma.scrapeRun.update({
        where: { id: scrapeRun.id },
        data: {
          status: finalStatus,
          completedAt: new Date(),
          errorMessage: finalErrorMessage,
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

  // Defence-in-depth: refuse any post whose external_id starts with
  // 'post_content'. This was the inner-container id from a long-fixed
  // selector bug that double-counted every post. We deleted 286 such
  // rows from the DB in 2026; keep them out for good.
  const cleanPosts = posts.filter((p) => !p.externalId.startsWith('post_content'));
  if (cleanPosts.length !== posts.length) {
    console.warn(
      `    Dropped ${posts.length - cleanPosts.length} post_content_* duplicate(s) from this page`,
    );
  }

  // Add content hashes to posts
  const postsWithHashes: PostWithHash[] = cleanPosts.map((post) => ({
    ...post,
    contentHash: hashContent(post.content),
  }));

  // Get existing posts to check for changes (with retry)
  const existingPosts = await retryWithBackoff(
    () => prisma.post.findMany({
      where: {
        threadId,
        externalId: { in: cleanPosts.map((p) => p.externalId) },
      },
      select: {
        id: true,
        externalId: true,
        contentHash: true,
        postedAt: true,
      },
    }),
    { maxAttempts: 3 }
  );

  const existingPostMap = new Map(
    existingPosts.map((p) => [p.externalId, p])
  );

  // Separate posts into new, changed, metadata-only-backfill, and unchanged.
  // The metadata-only backfill catches posts whose content hash hasn't moved
  // but whose `postedAt` was previously NULL (e.g. scraped before the adapter
  // learned how to read the author byline). Without this branch a fresh
  // re-scrape would leave historical postedAt columns NULL forever.
  const newPosts: PostWithHash[] = [];
  const changedPosts: PostWithHash[] = [];
  const postedAtBackfill: Array<{ id: string; postedAt: Date }> = [];

  for (const post of postsWithHashes) {
    const existing = existingPostMap.get(post.externalId);
    if (!existing) {
      newPosts.push(post);
    } else if (existing.contentHash !== post.contentHash) {
      changedPosts.push(post);
    } else if (existing.postedAt == null && post.postedAt != null) {
      postedAtBackfill.push({ id: existing.id, postedAt: post.postedAt });
    }
  }

  const unchangedCount =
    cleanPosts.length - newPosts.length - changedPosts.length - postedAtBackfill.length;
  console.log(
    `    New: ${newPosts.length}, Changed: ${changedPosts.length}, postedAt-backfill: ${postedAtBackfill.length}, Unchanged: ${unchangedCount}`,
  );

  // Process new posts in batches with retry
  for (let i = 0; i < newPosts.length; i += BATCH_SIZE) {
    if (shutdownRequested) break;
    
    const batch = newPosts.slice(i, i + BATCH_SIZE);
    
    await retryWithBackoff(
      () => prisma.$transaction(async (tx) => {
        await tx.post.createMany({
          data: batch.map((post) => ({
            threadId,
            externalId: post.externalId,
            authorName: post.authorName,
            authorNationality: post.authorNationality,
            content: post.content,
            contentHash: post.contentHash,
            postedAt: post.postedAt,
            pageNumber: post.pageNumber,
          })),
          skipDuplicates: true,
        });

        const createdPosts = await tx.post.findMany({
          where: {
            threadId,
            externalId: { in: batch.map((p) => p.externalId) },
          },
          select: { id: true, externalId: true, content: true },
        });

        // Build nationality lookup from the original scraped batch (the post
        // model doesn't store the same field directly).
        const nationalityMap = new Map(batch.map((p) => [p.externalId, p.authorNationality]));

        // We can't use createMany for cases because we need to also insert their
        // events (one row per ExtractedCase). Use individual upserts in the same
        // transaction so a partial failure rolls everything back.
        for (const dbPost of createdPosts) {
          const nationality = nationalityMap.get(dbPost.externalId);
          const extraction = extractCaseData(dbPost.content, nationality);
          if (extraction.confidence < MIN_CONFIDENCE) continue;

          const created = await tx.extractedCase.upsert({
            where: { postId: dbPost.id },
            create: { postId: dbPost.id, ...caseDataFromExtraction(extraction) },
            update: { ...caseDataFromExtraction(extraction), extractedAt: new Date() },
            select: { id: true },
          });

          await syncCaseEvents(tx, created.id, extraction);
          casesExtracted++;
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
            authorNationality: post.authorNationality,
            scrapedAt: new Date(),
            pageNumber: post.pageNumber,
            // Only overwrite postedAt if we have a fresh value — adapters can
            // legitimately return null (no byline parsed) and we don't want
            // a regression there to clear a previously-good timestamp.
            ...(post.postedAt != null ? { postedAt: post.postedAt } : {}),
          },
        });

        const extraction = extractCaseData(post.content, post.authorNationality);
        if (extraction.confidence >= MIN_CONFIDENCE) {
          const upserted = await tx.extractedCase.upsert({
            where: { postId: existing.id },
            create: { postId: existing.id, ...caseDataFromExtraction(extraction) },
            update: { ...caseDataFromExtraction(extraction), extractedAt: new Date() },
            select: { id: true },
          });
          await syncCaseEvents(tx, upserted.id, extraction);
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

  // Bulk-backfill postedAt for posts whose body is unchanged. We do this in
  // batches of `updateMany`-style individual updates so a single bad row
  // doesn't take the whole page's worth of writes down.
  if (postedAtBackfill.length > 0) {
    const BACKFILL_BATCH = 50;
    for (let i = 0; i < postedAtBackfill.length; i += BACKFILL_BATCH) {
      if (shutdownRequested) break;
      const batch = postedAtBackfill.slice(i, i + BACKFILL_BATCH);
      await retryWithBackoff(
        () => prisma.$transaction(
          batch.map((row) =>
            prisma.post.update({
              where: { id: row.id },
              data: { postedAt: row.postedAt },
            }),
          ),
        ),
        {
          maxAttempts: 3,
          onRetry: (attempt, error) => {
            console.log(`    postedAt backfill retry ${attempt}/3: ${error.message}`);
          },
        },
      );
    }
  }

  return { postsProcessed, casesExtracted };
}
