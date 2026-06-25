import { prisma, Prisma } from '@ilr/db';
import { extractCaseData, EXTRACTOR_VERSION } from './extractor.js';
import { caseDataFromExtraction, syncCaseEvents } from './persistence.js';

export interface ReextractOptions {
  /**
   * Re-extract any case whose extractorVersion is strictly less than this string.
   * String comparison works fine for our "1.x" versions; switch to a semver
   * comparator if we ever need 1.10 vs 1.2.
   */
  versionBelow?: string;

  /** Re-extract every case regardless of version. Mutually exclusive with versionBelow. */
  all?: boolean;

  /** Only re-extract cases whose source post was scraped after this date. */
  since?: Date;

  /** Limit the number of posts processed (useful for trial runs). */
  limit?: number;

  /** Don't write to the DB; just print what would change. */
  dryRun?: boolean;

  /** Batch size for DB transactions. */
  batchSize?: number;
}

interface ReextractStats {
  postsConsidered: number;
  casesUpserted: number;
  casesDeleted: number;
  belowConfidence: number;
}

const MIN_CONFIDENCE = 0.3;

/**
 * Re-run the current extractor against existing posts. Useful when the
 * extractor improves and we want to backfill the new fields without
 * re-scraping the forum.
 *
 * Posts are processed by `id` ASC for deterministic ordering. We process in
 * batches and use a transaction per batch so a failure rolls back only the
 * current batch.
 */
export async function reextract(options: ReextractOptions = {}): Promise<ReextractStats> {
  const { versionBelow, all, since, limit, dryRun = false, batchSize = 100 } = options;

  if (versionBelow && all) {
    throw new Error('Pass either --version-below OR --all, not both.');
  }

  const stats: ReextractStats = {
    postsConsidered: 0,
    casesUpserted: 0,
    casesDeleted: 0,
    belowConfidence: 0,
  };

  // We iterate posts (not cases) because some posts may not currently have an
  // extracted case but might now under the improved extractor.
  let cursor: string | null = null;
  let totalProcessed = 0;

  for (;;) {
    if (limit !== undefined && totalProcessed >= limit) break;

    const take = Math.min(batchSize, limit !== undefined ? limit - totalProcessed : batchSize);

    const where: Prisma.PostWhereInput = {};
    if (since) where.scrapedAt = { gte: since };

    if (versionBelow) {
      // Only posts whose linked case has a version below the threshold
      // OR posts with no extracted case yet.
      where.OR = [
        { extractedCase: null },
        { extractedCase: { extractorVersion: { lt: versionBelow } } },
      ];
    } else if (!all) {
      // Default: only posts that don't yet have a case OR whose case is
      // strictly older than the current extractor version.
      where.OR = [
        { extractedCase: null },
        { extractedCase: { extractorVersion: { lt: EXTRACTOR_VERSION } } },
      ];
    }

    const posts: Array<{
      id: string;
      content: string;
      authorNationality: string | null;
    }> = await prisma.post.findMany({
      where: cursor ? { ...where, id: { gt: cursor } } : where,
      orderBy: { id: 'asc' },
      take,
      select: { id: true, content: true, authorNationality: true },
    });

    if (posts.length === 0) break;
    cursor = posts[posts.length - 1]!.id;

    for (const post of posts) {
      stats.postsConsidered++;
      totalProcessed++;

      const extraction = extractCaseData(post.content, post.authorNationality ?? undefined);

      if (extraction.confidence < MIN_CONFIDENCE) {
        stats.belowConfidence++;

        if (!dryRun) {
          // Delete the existing case (if any) since it no longer meets confidence —
          // this prevents stale low-confidence rows from lingering after extractor regressions.
          const deleted = await prisma.extractedCase.deleteMany({ where: { postId: post.id } });
          if (deleted.count > 0) stats.casesDeleted += deleted.count;
        }
        continue;
      }

      if (dryRun) {
        stats.casesUpserted++;
        continue;
      }

      await prisma.$transaction(async (tx) => {
        const upserted = await tx.extractedCase.upsert({
          where: { postId: post.id },
          create: { postId: post.id, ...caseDataFromExtraction(extraction) },
          update: { ...caseDataFromExtraction(extraction), extractedAt: new Date() },
          select: { id: true },
        });
        await syncCaseEvents(tx, upserted.id, extraction);
      });

      stats.casesUpserted++;
    }

    // Progress logging every batch.
    console.log(
      `  ...processed ${stats.postsConsidered} posts, upserted ${stats.casesUpserted}, deleted ${stats.casesDeleted}, below-conf ${stats.belowConfidence}`
    );
  }

  return stats;
}
