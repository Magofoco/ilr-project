/**
 * One-shot diagnostic to audit scraper + extractor coverage.
 *
 * Answers the questions:
 *  - Which pages of the source thread are actually in the DB?
 *  - Why is postedAt NULL for so many rows?
 *  - What fraction of posts have garbage externalIds?
 *  - What fraction of posts contain a self-quote (user updating their own
 *    timeline), and what does the live extractor make of those?
 *  - What does a sample of "low coverage" extracted fields look like in the
 *    raw text (biometricsLocation, serviceTier)?
 */

import { prisma } from '@ilr/db';
import { extractCaseData } from './extraction/extractor.js';

async function main() {
  // ============================================================
  // 1. Page coverage of the source thread
  // ============================================================
  console.log('=== PAGE COVERAGE ===');
  const threads = await prisma.thread.findMany({
    select: { id: true, title: true, totalPages: true, lastScrapedPage: true },
  });
  for (const t of threads) {
    console.log(`  thread "${t.title}"`);
    console.log(`    totalPages: ${t.totalPages}, lastScrapedPage: ${t.lastScrapedPage}`);
    const byPage = await prisma.post.groupBy({
      by: ['pageNumber'],
      where: { threadId: t.id },
      _count: true,
      orderBy: { pageNumber: 'asc' },
    });
    const pagesPresent = byPage.map((p) => p.pageNumber).filter((p): p is number => p != null);
    console.log(`    pages with posts: ${pagesPresent.length}`);
    if (pagesPresent.length) {
      console.log(`    contiguous? ${isContiguous(pagesPresent)}`);
      console.log(`    page set: ${rangify(pagesPresent)}`);
      const expected = (t.totalPages ?? 0) * 24;
      const got = byPage.reduce((s, p) => s + p._count, 0);
      console.log(`    posts in DB: ${got} (would expect ~${expected} if every page were scraped)`);
    }
  }

  // ============================================================
  // 2. postedAt coverage
  // ============================================================
  console.log('\n=== postedAt COVERAGE ===');
  const totalPosts = await prisma.post.count();
  const withPostedAt = await prisma.post.count({ where: { postedAt: { not: null } } });
  console.log(`  posts total:           ${totalPosts}`);
  console.log(`  postedAt populated:    ${withPostedAt} (${pct(withPostedAt, totalPosts)})`);
  console.log(`  postedAt NULL:         ${totalPosts - withPostedAt}`);

  // ============================================================
  // 3. Garbage externalIds
  // ============================================================
  console.log('\n=== EXTERNAL ID SANITY ===');
  const allPosts = await prisma.post.findMany({ select: { externalId: true } });
  const groups = new Map<string, number>();
  for (const p of allPosts) {
    const key = /^p\d+$/.test(p.externalId) ? 'p<digits>' : `OTHER: ${p.externalId.slice(0, 30)}`;
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  for (const [k, c] of [...groups.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(40)} ${c}`);
  }

  // ============================================================
  // 4. Self-quote detection — how many posts include a quote of an
  //    earlier post in the same thread (most likely the same author
  //    updating their own timeline)?
  // ============================================================
  console.log('\n=== SELF-QUOTE INCIDENCE (sample of 500 posts) ===');
  // We don't have HTML any more — only the stripped content — so we
  // can only proxy: look for "wrote:" markers in stripped text (they
  // would have been stripped by stripHtmlWithQuotes if intact) AND
  // posts that share an author with an earlier post in the same thread.
  const sample = await prisma.post.findMany({
    take: 500,
    orderBy: { id: 'asc' },
    select: {
      id: true,
      threadId: true,
      authorName: true,
      content: true,
      pageNumber: true,
      externalId: true,
      extractedCase: { select: { confidence: true, applicationDate: true, decisionDate: true } },
    },
  });

  // Bucket per (threadId, authorName)
  const byAuthor = new Map<string, typeof sample>();
  for (const p of sample) {
    if (!p.authorName) continue;
    const k = `${p.threadId}|${p.authorName}`;
    if (!byAuthor.has(k)) byAuthor.set(k, []);
    byAuthor.get(k)!.push(p);
  }

  let repeatAuthors = 0;
  let postsByRepeatAuthors = 0;
  const repeatGroups: Array<typeof sample> = [];
  for (const posts of byAuthor.values()) {
    if (posts.length >= 2) {
      repeatAuthors++;
      postsByRepeatAuthors += posts.length;
      repeatGroups.push(posts);
    }
  }
  console.log(`  distinct (thread, author) pairs in sample: ${byAuthor.size}`);
  console.log(`  pairs with ≥2 posts (multi-post timelines): ${repeatAuthors}`);
  console.log(`  posts attributable to those repeat authors: ${postsByRepeatAuthors}`);

  console.log('\n  Examples of multi-post timelines (first 5):');
  for (const grp of repeatGroups.slice(0, 5)) {
    const sorted = grp.slice().sort((a, b) => (a.pageNumber ?? 0) - (b.pageNumber ?? 0));
    console.log(`    author=${sorted[0]!.authorName} (${sorted.length} posts)`);
    for (const p of sorted) {
      console.log(`      page=${p.pageNumber} id=${p.externalId} len=${p.content.length} conf=${p.extractedCase?.confidence ?? '(no case)'} firstLine="${p.content.split('\n')[0]?.slice(0, 80)}"`);
    }
  }

  // ============================================================
  // 5. biometricsLocation — what's IN the post body that we're missing?
  // ============================================================
  console.log('\n=== biometricsLocation MISSES (random sample of 20 posts where DB has NULL) ===');
  const nullLocs = await prisma.extractedCase.findMany({
    where: { biometricsLocation: null, biometricsDate: { not: null } },
    take: 20,
    select: {
      id: true,
      post: { select: { content: true } },
    },
  });
  console.log(`  total cases with biometricsDate but NULL location: ${nullLocs.length}+ (showing sample)`);
  for (const c of nullLocs.slice(0, 5)) {
    const lines = c.post.content.split('\n');
    const bioLines = lines.filter((l) => /biometr/i.test(l));
    console.log(`    case=${c.id}`);
    for (const l of bioLines.slice(0, 3)) {
      console.log(`      "${l.trim().slice(0, 200)}"`);
    }
  }

  // ============================================================
  // 6. serviceTier — same audit
  // ============================================================
  console.log('\n=== serviceTier MISSES (sample of 20 posts where DB has NULL) ===');
  const nullTiers = await prisma.extractedCase.findMany({
    where: { serviceTier: null, applicationDate: { not: null } },
    take: 20,
    select: {
      id: true,
      post: { select: { content: true } },
    },
  });
  for (const c of nullTiers.slice(0, 8)) {
    const lines = c.post.content.split('\n');
    const tierLines = lines.filter((l) =>
      /priority|standard|super|application\s+type|fee|service\s+tier/i.test(l),
    );
    console.log(`    case=${c.id}`);
    for (const l of tierLines.slice(0, 3)) {
      console.log(`      "${l.trim().slice(0, 200)}"`);
    }
  }

  // ============================================================
  // 7. Live re-run of the extractor on the recent posts to see what
  //    we'd get NOW vs. what's in the DB
  // ============================================================
  console.log('\n=== LIVE RE-EXTRACT ON 5 NEWEST POSTS WITHOUT A CASE ===');
  const orphans = await prisma.post.findMany({
    where: { extractedCase: null },
    orderBy: { scrapedAt: 'desc' },
    take: 5,
    select: { id: true, externalId: true, pageNumber: true, authorNationality: true, content: true },
  });
  for (const p of orphans) {
    console.log(`  --- post ${p.externalId} (page ${p.pageNumber}, ${p.content.length} chars) ---`);
    const live = extractCaseData(p.content, p.authorNationality ?? undefined);
    console.log(`    live confidence: ${live.confidence.toFixed(2)}`);
    console.log(`    live snapshot:   route=${live.applicationRoute ?? '?'} tier=${live.serviceTier ?? '?'} appDate=${live.applicationDate?.toISOString().slice(0, 10) ?? '?'} bioDate=${live.biometricsDate?.toISOString().slice(0, 10) ?? '?'} decDate=${live.decisionDate?.toISOString().slice(0, 10) ?? '?'} outcome=${live.outcome ?? '?'}`);
    console.log(`    first 200 chars: "${p.content.slice(0, 200).replace(/\s+/g, ' ')}"`);
  }

  await prisma.$disconnect();
}

function pct(n: number, d: number): string {
  return d === 0 ? '0%' : `${((100 * n) / d).toFixed(1)}%`;
}

function isContiguous(nums: number[]): boolean {
  for (let i = 1; i < nums.length; i++) {
    if (nums[i]! - nums[i - 1]! !== 1) return false;
  }
  return true;
}

function rangify(nums: number[]): string {
  if (nums.length === 0) return '';
  const ranges: string[] = [];
  let start = nums[0]!;
  let prev = start;
  for (let i = 1; i < nums.length; i++) {
    const n = nums[i]!;
    if (n - prev === 1) {
      prev = n;
    } else {
      ranges.push(start === prev ? `${start}` : `${start}-${prev}`);
      start = n;
      prev = n;
    }
  }
  ranges.push(start === prev ? `${start}` : `${start}-${prev}`);
  return ranges.join(', ');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
