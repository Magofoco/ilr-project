/**
 * One-shot cleanup: drop any Post (and its dependent rows) whose
 * externalId doesn't match the canonical phpBB post-id shape /^p\d+$/.
 *
 * In production the DB has 5 stragglers from an older scraper run with
 * a permissive selector (`page-header`, `page-body`, `page-body-content`,
 * `page-wrapper`, `page-footer`). The new selector + post-filter in
 * `immigration-boards.ts` will not let them in again, but the existing
 * rows still need to go.
 *
 * Cascading deletes (ExtractedCase.onDelete=Cascade, CaseEvent.onDelete=Cascade)
 * mean a single Post delete cleans up the linked case and its events.
 *
 * Usage:
 *   pnpm --filter @ilr/worker exec tsx src/scripts/cleanup-garbage-posts.ts
 *   pnpm --filter @ilr/worker exec tsx src/scripts/cleanup-garbage-posts.ts --dry-run
 */
import { prisma } from '@ilr/db';

const dryRun = process.argv.includes('--dry-run');

async function main() {
  console.log('Looking for posts with non-standard external IDs...\n');

  const allPosts = await prisma.post.findMany({
    select: {
      id: true,
      externalId: true,
      pageNumber: true,
      authorName: true,
      content: true,
      extractedCase: { select: { id: true, confidence: true } },
    },
  });

  const bad = allPosts.filter((p) => !/^p\d+$/.test(p.externalId));

  if (bad.length === 0) {
    console.log('No garbage posts found — DB is clean.');
    await prisma.$disconnect();
    return;
  }

  console.log(`Found ${bad.length} garbage post(s):\n`);
  for (const p of bad) {
    console.log(`  id=${p.id} externalId=${p.externalId} page=${p.pageNumber} author=${p.authorName}`);
    console.log(`    case=${p.extractedCase ? `${p.extractedCase.id} (conf ${p.extractedCase.confidence})` : '(none)'}`);
    console.log(`    content[0..80]="${p.content.slice(0, 80).replace(/\s+/g, ' ')}"`);
  }

  if (dryRun) {
    console.log('\n--dry-run set; not deleting.');
    await prisma.$disconnect();
    return;
  }

  const ids = bad.map((p) => p.id);
  const deleted = await prisma.post.deleteMany({ where: { id: { in: ids } } });
  console.log(`\nDeleted ${deleted.count} post(s) (cascade also removed their cases and events).`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
