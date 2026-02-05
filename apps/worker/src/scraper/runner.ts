import { prisma, type SourceForum } from '@ilr/db';
import type { SourceAdapter, ScrapedThread, ScrapeProgress } from '@ilr/shared';
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

export async function runScraper(options: RunScraperOptions): Promise<void> {
  const { source, adapter, since, maxThreads, dryRun, resume = true } = options;

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
      const thread = threads[i]!;
      console.log(`[${i + 1}/${threads.length}] Processing: ${thread.title.slice(0, 50)}...`);

      try {
        // Rate limiting with jitter
        await delay(getJitter());

        // Get or create thread in DB
        const dbThread = dryRun
          ? null
          : await prisma.thread.upsert({
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
            });

        // Determine starting page for resume
        let startFromPage = 1;
        if (resume && dbThread?.lastScrapedPage && dbThread.lastScrapedPage > 0) {
          // Start from the last scraped page (not +1, in case it was incomplete)
          startFromPage = dbThread.lastScrapedPage;
          console.log(`  Resuming from page ${startFromPage}`);
        }

        // Step 3: Get posts from thread with progress tracking
        const onProgress = async (progress: ScrapeProgress) => {
          // Save progress to DB periodically
          if (!dryRun && dbThread) {
            await prisma.thread.update({
              where: { id: dbThread.id },
              data: {
                lastScrapedPage: progress.lastScrapedPage,
                totalPages: progress.totalPages,
              },
            });
          }
        };

        const { posts, progress } = await adapter.getPosts(thread, {
          startFromPage,
          onProgress,
        });
        
        stats.postsFound += posts.length;
        console.log(`  Found ${posts.length} posts (pages ${startFromPage}-${progress.lastScrapedPage} of ${progress.totalPages})`);

        // Step 4: Process each post
        for (const post of posts) {
          const contentHash = hashContent(post.content);

          // Check if post already exists with same content
          if (!dryRun && dbThread) {
            const existingPost = await prisma.post.findUnique({
              where: {
                threadId_externalId: {
                  threadId: dbThread.id,
                  externalId: post.externalId,
                },
              },
              select: { contentHash: true },
            });

            // Skip if content unchanged
            if (existingPost?.contentHash === contentHash) {
              continue;
            }
          }

          // Save post
          const dbPost = dryRun
            ? null
            : await prisma.post.upsert({
                where: {
                  threadId_externalId: {
                    threadId: dbThread!.id,
                    externalId: post.externalId,
                  },
                },
                create: {
                  threadId: dbThread!.id,
                  externalId: post.externalId,
                  authorName: post.authorName,
                  content: post.content,
                  contentHash,
                  postedAt: post.postedAt,
                  pageNumber: post.pageNumber,
                },
                update: {
                  content: post.content,
                  contentHash,
                  scrapedAt: new Date(),
                  pageNumber: post.pageNumber,
                },
              });

          stats.postsScraped++;

          // Step 5: Extract case data
          const extraction = extractCaseData(post.content);
          
          if (extraction.confidence > 0.3) {
            // Only save if we have reasonable confidence
            if (!dryRun && dbPost) {
              await prisma.extractedCase.upsert({
                where: { postId: dbPost.id },
                create: {
                  postId: dbPost.id,
                  ...extraction,
                },
                update: {
                  ...extraction,
                },
              });
              stats.casesExtracted++;
              console.log(`    Extracted case (confidence: ${(extraction.confidence * 100).toFixed(0)}%): ${extraction.applicationRoute || 'unknown route'}`);
            } else if (dryRun) {
              console.log(`    [DRY RUN] Would extract: ${extraction.applicationRoute || 'unknown route'} (${(extraction.confidence * 100).toFixed(0)}%)`);
              stats.casesExtracted++;
            }
          }
        }

        // Update final progress
        if (!dryRun && dbThread) {
          await prisma.thread.update({
            where: { id: dbThread.id },
            data: {
              lastScrapedPage: progress.lastScrapedPage,
              totalPages: progress.totalPages,
              lastScrapedAt: new Date(),
            },
          });
        }

        stats.threadsScraped++;
      } catch (error) {
        console.error(`  Error processing thread ${thread.externalId}:`, error);
        // Continue with other threads
      }
    }

    // Cleanup adapter resources
    if (adapter.cleanup) {
      await adapter.cleanup();
    }

    // Update scrape run with success
    if (scrapeRun) {
      await prisma.scrapeRun.update({
        where: { id: scrapeRun.id },
        data: {
          status: 'completed',
          completedAt: new Date(),
          ...stats,
        },
      });
    }

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
    throw error;
  }
}
