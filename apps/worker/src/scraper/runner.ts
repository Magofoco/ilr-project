import { prisma, Prisma, type SourceForum } from '@ilr/db';
import type { SourceAdapter, ScrapedPost, ScrapeProgress } from '@ilr/shared';
import { retryWithBackoff } from '@ilr/shared';
import { extractCaseData } from '../extraction/extractor.js';
import { hashContent, delay, getJitter } from '../utils/helpers.js';

interface RunScraperOptions {
  source: SourceForum;
  adapter: SourceAdapter;
  since?: Date;
  maxThreads?: number;
  dryRun: boolean;
  resume?: boolean; // Whether to resume from last scraped page
}

// Batch size for database operations
const BATCH_SIZE = 50;

// Pages to process before saving to DB (chunked processing)
const PAGES_PER_CHUNK = 10;

interface PostWithHash extends ScrapedPost {
  contentHash: string;
}

// Track current scrape run for graceful shutdown
let currentScrapeRunId: string | null = null;
let currentAdapter: SourceAdapter | null = null;
let shutdownRequested = false;

/**
 * Graceful shutdown handler - called when SIGINT/SIGTERM received
 */
export async function gracefulShutdown(): Promise<void> {
  shutdownRequested = true;
  
  // Mark current scrape run as failed if one is running
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
  
  // Cleanup adapter resources
  if (currentAdapter?.cleanup) {
    try {
      await currentAdapter.cleanup();
      console.log('  Cleaned up browser resources');
    } catch (error) {
      console.error('  Error cleaning up adapter:', error);
    }
  }
  
  // Disconnect from database
  await prisma.$disconnect();
}

/**
 * Check if shutdown was requested
 */
function shouldStop(): boolean {
  return shutdownRequested;
}

export async function runScraper(options: RunScraperOptions): Promise<void> {
  const { source, adapter, since, maxThreads, dryRun, resume = true } = options;

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
          },
        },
      });

  currentScrapeRunId = scrapeRun?.id || null;

  let stats = {
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
    console.log(`Found ${threads.length} threads`);

    // Step 2: Process each thread
    for (let i = 0; i < threads.length; i++) {
      if (shouldStop()) {
        console.log('Shutdown requested, stopping...');
        break;
      }

      const thread = threads[i]!;
      console.log(`[${i + 1}/${threads.length}] Processing: ${thread.title.slice(0, 50)}...`);

      try {
        // Rate limiting with jitter
        await delay(getJitter());

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

        // Step 3: Get posts from thread with chunked progress tracking
        let totalPages = 1;
        let currentChunkStart = startFromPage;
        let allPostsProcessed = 0;
        let allCasesExtracted = 0;

        // First, get total pages
        const initialResult = await adapter.getPosts(thread, {
          startFromPage: 1,
          onProgress: async (progress) => {
            totalPages = progress.totalPages;
          },
        });

        // If we only fetched page 1 to get total, we need to refetch from startFromPage
        // But our adapter fetches all pages at once, so we use chunked approach differently
        
        // For chunked processing, we process the posts in chunks after fetching
        const { posts, progress } = await adapter.getPosts(thread, {
          startFromPage,
          onProgress: async (prog: ScrapeProgress) => {
            // Save progress every PAGES_PER_CHUNK pages
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
            
            // Check for shutdown
            if (shouldStop()) {
              throw new Error('Shutdown requested');
            }
          },
        });

        stats.postsFound += posts.length;
        console.log(`  Found ${posts.length} posts (pages ${startFromPage}-${progress.lastScrapedPage} of ${progress.totalPages})`);

        // Step 4: Process posts in chunks
        if (dryRun) {
          for (const post of posts) {
            if (shouldStop()) break;
            const extraction = extractCaseData(post.content);
            if (extraction.confidence > 0.3) {
              console.log(`    [DRY RUN] Would extract: ${extraction.applicationRoute || 'unknown route'} (${(extraction.confidence * 100).toFixed(0)}%)`);
              stats.casesExtracted++;
            }
            stats.postsScraped++;
          }
        } else if (dbThread) {
          // Process in chunks of posts from PAGES_PER_CHUNK pages
          const postsPerChunk = PAGES_PER_CHUNK * 25; // ~250 posts per chunk
          
          for (let chunkStart = 0; chunkStart < posts.length; chunkStart += postsPerChunk) {
            if (shouldStop()) {
              console.log('  Shutdown requested, saving progress...');
              break;
            }

            const chunk = posts.slice(chunkStart, chunkStart + postsPerChunk);
            console.log(`  Processing chunk ${Math.floor(chunkStart / postsPerChunk) + 1}/${Math.ceil(posts.length / postsPerChunk)} (${chunk.length} posts)...`);
            
            const result = await processPostsInBatches(dbThread.id, chunk);
            allPostsProcessed += result.postsProcessed;
            allCasesExtracted += result.casesExtracted;
            
            // Update progress after each chunk
            const lastPageInChunk = Math.max(...chunk.map(p => p.pageNumber || 0));
            if (lastPageInChunk > 0) {
              await retryWithBackoff(
                () => prisma.thread.update({
                  where: { id: dbThread.id },
                  data: {
                    lastScrapedPage: lastPageInChunk,
                    totalPages: progress.totalPages,
                  },
                }),
                { maxAttempts: 2 }
              );
            }
          }
          
          stats.postsScraped += allPostsProcessed;
          stats.casesExtracted += allCasesExtracted;
          console.log(`  Processed ${allPostsProcessed} posts, extracted ${allCasesExtracted} cases`);
        }

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
        console.error(`  Error processing thread ${thread.externalId}:`, error);
        // Continue with other threads
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

    console.log('\nScrape stats:', stats);
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
    }
    currentScrapeRunId = null;
    
    throw error;
  }
}

/**
 * Process posts in batches for better performance
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
    // Unchanged posts are skipped
  }

  console.log(`    New: ${newPosts.length}, Changed: ${changedPosts.length}, Unchanged: ${posts.length - newPosts.length - changedPosts.length}`);

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
        // Update post
        await tx.post.update({
          where: { id: existing.id },
          data: {
            content: post.content,
            contentHash: post.contentHash,
            scrapedAt: new Date(),
            pageNumber: post.pageNumber,
          },
        });

        // Re-extract case data
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
