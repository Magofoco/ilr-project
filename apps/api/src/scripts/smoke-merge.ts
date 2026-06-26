/**
 * Read-only smoke test for the per-applicant case merge.
 *
 * Loads the live cohort with the default estimator settings and prints
 * before/after counts plus a snapshot of the most-merged cases. Useful for
 * verifying a merge-helper change before deploying.
 *
 * Run with:
 *   pnpm --filter @ilr/api tsx src/scripts/smoke-merge.ts
 */
import { prisma } from '@ilr/db';
import { loadCohort } from '../lib/cohort.js';

const DEFAULT_WINDOW_DAYS = 730;

async function main() {
  const now = new Date();

  // Raw count of cases that would PASS the cohort filter before any merge,
  // using exactly the same WHERE clause as loadCohort but without grouping.
  const raw = await prisma.extractedCase.count({
    where: {
      applicationDate: {
        not: null,
        gte: new Date(now.getTime() - DEFAULT_WINDOW_DAYS * 24 * 3600 * 1000),
      },
      confidence: { gte: 0.5 },
    },
  });

  // All-time raw count, as a sanity baseline.
  const rawAllTime = await prisma.extractedCase.count({
    where: { applicationDate: { not: null }, confidence: { gte: 0.5 } },
  });

  // Merged cohort for the default 2-year window.
  const merged = await loadCohort({ windowDays: DEFAULT_WINDOW_DAYS }, now);
  // Merged cohort all-time.
  const mergedAllTime = await loadCohort({ windowDays: 365 * 100 }, now);

  console.log('Cohort merge smoke test\n');
  console.log('Default 2-year window:');
  console.log(`  raw extracted_cases rows : ${raw}`);
  console.log(`  merged cases             : ${merged.length}`);
  console.log(
    `  inflation                : ${raw > 0 ? `${(((raw - merged.length) / raw) * 100).toFixed(1)}%` : 'n/a'}`,
  );

  console.log('\nAll time:');
  console.log(`  raw extracted_cases rows : ${rawAllTime}`);
  console.log(`  merged cases             : ${mergedAllTime.length}`);
  console.log(
    `  inflation                : ${rawAllTime > 0 ? `${(((rawAllTime - mergedAllTime.length) / rawAllTime) * 100).toFixed(1)}%` : 'n/a'}`,
  );

  // Show the top-N most-merged cases (those that absorbed the most posts).
  const topMerged = [...mergedAllTime]
    .filter((c) => c.contributingPostCount > 1)
    .sort((a, b) => b.contributingPostCount - a.contributingPostCount)
    .slice(0, 10);

  console.log('\nTop multi-post cases (cohort-eligible only):');
  if (topMerged.length === 0) {
    console.log('  (none — every applicant posts exactly once in their thread)');
  }
  for (const c of topMerged) {
    const dec = c.decisionDate ? c.decisionDate.toISOString().slice(0, 10) : 'pending';
    const app = c.applicationDate.toISOString().slice(0, 10);
    console.log(
      `  ${c.id.padEnd(48)} ${String(c.contributingPostCount).padStart(2)} posts ` +
        `| ${(c.applicationRoute ?? '?').padEnd(14)} | applied ${app} | decided ${dec} | outcome ${c.outcome}`,
    );
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
