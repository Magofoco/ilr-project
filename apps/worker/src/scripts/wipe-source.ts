/**
 * Wipe all scraped data for a source forum (threads, posts, extracted cases,
 * case events, scrape runs). Used to recover from selector bugs or schema
 * changes that invalidated the corpus, before re-scraping clean.
 *
 * Usage:
 *   pnpm --filter @ilr/worker exec tsx src/scripts/wipe-source.ts <sourceName>
 *
 * Dry-run by default. To actually delete, set CONFIRM_WIPE=<sourceName>:
 *   CONFIRM_WIPE=immigrationboards pnpm --filter @ilr/worker exec tsx \
 *     src/scripts/wipe-source.ts immigrationboards
 *
 * The SourceForum row itself is left in place (the seed is the source of
 * truth and shouldn't need re-seeding).
 */
import { prisma } from '@ilr/db';

async function main() {
  const sourceName = process.argv[2];
  if (!sourceName) {
    console.error('Usage: tsx src/scripts/wipe-source.ts <sourceName>');
    console.error('Example: tsx src/scripts/wipe-source.ts immigrationboards');
    process.exit(1);
  }

  const source = await prisma.sourceForum.findUnique({
    where: { name: sourceName },
    select: { id: true, name: true, baseUrl: true },
  });

  if (!source) {
    console.error(`Source "${sourceName}" not found in source_forums.`);
    process.exit(1);
  }

  console.log(`Source: ${source.name} (${source.id})`);
  console.log(`  baseUrl: ${source.baseUrl}\n`);

  const [threadCount, postCount, caseCount, eventCount, scrapeRunCount] = await Promise.all([
    prisma.thread.count({ where: { sourceId: source.id } }),
    prisma.post.count({ where: { thread: { sourceId: source.id } } }),
    prisma.extractedCase.count({ where: { post: { thread: { sourceId: source.id } } } }),
    prisma.caseEvent.count({ where: { case: { post: { thread: { sourceId: source.id } } } } }),
    prisma.scrapeRun.count({ where: { sourceId: source.id } }),
  ]);

  console.log('Rows to delete (cascades from threads + scrape_runs):');
  console.log(`  threads:         ${threadCount}`);
  console.log(`  posts:           ${postCount}`);
  console.log(`  extracted_cases: ${caseCount}`);
  console.log(`  case_events:     ${eventCount}`);
  console.log(`  scrape_runs:     ${scrapeRunCount}`);

  const confirm = process.env.CONFIRM_WIPE;
  if (confirm !== sourceName) {
    console.log(
      `\nDRY RUN. To actually delete, re-run with:\n  CONFIRM_WIPE=${sourceName} ...`
    );
    await prisma.$disconnect();
    return;
  }

  console.log('\nDeleting...');

  // Cascades handle the rest, but delete scrape_runs explicitly so we don't
  // leave dangling stats rows referring to a now-empty source.
  const deletedScrapeRuns = await prisma.scrapeRun.deleteMany({
    where: { sourceId: source.id },
  });
  console.log(`  scrape_runs: ${deletedScrapeRuns.count} deleted`);

  // Deleting threads cascades to posts -> extracted_cases -> case_events.
  const deletedThreads = await prisma.thread.deleteMany({
    where: { sourceId: source.id },
  });
  console.log(`  threads:     ${deletedThreads.count} deleted (cascaded to posts/cases/events)`);

  console.log('\nDone. Re-scrape with:');
  console.log(`  pnpm --filter @ilr/worker run scrape -s ${sourceName}`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
