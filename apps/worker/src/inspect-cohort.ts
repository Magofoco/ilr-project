import { prisma } from '@ilr/db';

async function main() {
  console.log('=== POST EXTERNAL ID PATTERNS ===');
  const idSamples = await prisma.post.findMany({
    select: { externalId: true, content: true, pageNumber: true },
    take: 1000,
  });
  const byPrefix = new Map<string, number>();
  for (const p of idSamples) {
    const prefix = p.externalId.replace(/\d+/g, '#');
    byPrefix.set(prefix, (byPrefix.get(prefix) ?? 0) + 1);
  }
  for (const [prefix, count] of [...byPrefix.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    console.log(`  ${prefix}: ${count}`);
  }

  console.log('\n=== POST CONTENT LENGTH DISTRIBUTION ===');
  const allLens = idSamples.map(p => p.content.length).sort((a, b) => a - b);
  console.log(`  min:  ${allLens[0]}`);
  console.log(`  p10:  ${allLens[Math.floor(allLens.length * 0.1)]}`);
  console.log(`  p25:  ${allLens[Math.floor(allLens.length * 0.25)]}`);
  console.log(`  p50:  ${allLens[Math.floor(allLens.length * 0.5)]}`);
  console.log(`  p75:  ${allLens[Math.floor(allLens.length * 0.75)]}`);
  console.log(`  p90:  ${allLens[Math.floor(allLens.length * 0.9)]}`);
  console.log(`  max:  ${allLens[allLens.length - 1]}`);

  console.log('\n=== SHORTEST POSTS (likely noise) ===');
  const shortest = [...idSamples].sort((a, b) => a.content.length - b.content.length).slice(0, 5);
  for (const p of shortest) {
    console.log(`  page ${p.pageNumber} id=${p.externalId} len=${p.content.length}`);
    console.log(`    "${p.content.slice(0, 120).replace(/\n/g, ' ')}"`);
  }

  console.log('\n=== LATEST SCRAPE RUN ===');
  const latestRun = await prisma.scrapeRun.findFirst({
    orderBy: { startedAt: 'desc' },
  });
  if (latestRun) {
    console.log(`  id:              ${latestRun.id}`);
    console.log(`  status:          ${latestRun.status}`);
    console.log(`  startedAt:       ${latestRun.startedAt.toISOString()}`);
    console.log(`  completedAt:     ${latestRun.completedAt?.toISOString() ?? 'still running?'}`);
    console.log(`  threadsScraped:  ${latestRun.threadsScraped}`);
    console.log(`  postsFound:      ${latestRun.postsFound}`);
    console.log(`  postsScraped:    ${latestRun.postsScraped}`);
    console.log(`  casesExtracted:  ${latestRun.casesExtracted}`);
    console.log(`  errorMessage:    ${latestRun.errorMessage ?? '(none)'}`);
    if (latestRun.errorDetails) {
      console.log(`  errorDetails:    ${JSON.stringify(latestRun.errorDetails).slice(0, 300)}`);
    }
  } else {
    console.log('  (no scrape runs found)');
  }

  console.log('\n=== THREAD STATE (resume info) ===');
  const threads = await prisma.thread.findMany({
    select: {
      id: true,
      title: true,
      url: true,
      lastScrapedPage: true,
      totalPages: true,
      lastScrapedAt: true,
      _count: { select: { posts: true } },
    },
  });
  for (const t of threads) {
    console.log(`  "${t.title}"`);
    console.log(`    url:             ${t.url}`);
    console.log(`    lastScrapedPage: ${t.lastScrapedPage}`);
    console.log(`    totalPages:      ${t.totalPages}`);
    console.log(`    lastScrapedAt:   ${t.lastScrapedAt?.toISOString() ?? 'never'}`);
    console.log(`    posts (DB):      ${t._count.posts}`);
  }

  console.log('\n=== POSTS PER PAGE (top 30 page numbers) ===');
  const postsByPage = await prisma.post.groupBy({
    by: ['pageNumber'],
    _count: true,
    orderBy: { pageNumber: 'asc' },
  });
  console.log(`  pages scraped: ${postsByPage.length} (min=${postsByPage[0]?.pageNumber}, max=${postsByPage.at(-1)?.pageNumber})`);
  for (const p of postsByPage.slice(0, 5)) {
    console.log(`  page ${p.pageNumber}: ${p._count} posts`);
  }
  if (postsByPage.length > 10) console.log('  ...');
  for (const p of postsByPage.slice(-5)) {
    console.log(`  page ${p.pageNumber}: ${p._count} posts`);
  }

  const total = await prisma.extractedCase.count();
  const decided = await prisma.extractedCase.count({
    where: { isPending: false, decisionDate: { not: null } },
  });
  const pending = await prisma.extractedCase.count({ where: { isPending: true } });
  const last730 = await prisma.extractedCase.count({
    where: {
      applicationDate: { gte: new Date(Date.now() - 730 * 24 * 60 * 60 * 1000) },
    },
  });

  console.log('=== TOTALS ===');
  console.log(`Total cases:       ${total}`);
  console.log(`Decided:           ${decided}`);
  console.log(`Pending:           ${pending}`);
  console.log(`Last 730 days:     ${last730} (default cohort window)`);

  console.log('\n=== BY APPLICATION ROUTE ===');
  const byRoute = await prisma.extractedCase.groupBy({
    by: ['applicationRoute'],
    _count: true,
    orderBy: { _count: { applicationRoute: 'desc' } },
  });
  byRoute.forEach((r) =>
    console.log(`  ${(r.applicationRoute ?? '(null)').padEnd(25)} ${r._count}`),
  );

  console.log('\n=== BY SERVICE TIER ===');
  const byTier = await prisma.extractedCase.groupBy({
    by: ['serviceTier'],
    _count: true,
    orderBy: { _count: { serviceTier: 'desc' } },
  });
  byTier.forEach((r) =>
    console.log(`  ${(r.serviceTier ?? '(null)').padEnd(20)} ${r._count}`),
  );

  console.log('\n=== BY NATIONALITY (top 15) ===');
  const byNat = await prisma.extractedCase.groupBy({
    by: ['applicantNationalityCode'],
    _count: true,
    orderBy: { _count: { applicantNationalityCode: 'desc' } },
    take: 15,
  });
  byNat.forEach((r) =>
    console.log(`  ${(r.applicantNationalityCode ?? '(null)').padEnd(8)} ${r._count}`),
  );

  console.log('\n=== BY BIOMETRICS LOCATION (top 15) ===');
  const byLoc = await prisma.extractedCase.groupBy({
    by: ['biometricsLocation'],
    _count: true,
    orderBy: { _count: { biometricsLocation: 'desc' } },
    take: 15,
  });
  byLoc.forEach((r) =>
    console.log(`  ${(r.biometricsLocation ?? '(null)').padEnd(25)} ${r._count}`),
  );

  console.log('\n=== OUTCOMES ===');
  const byOutcome = await prisma.extractedCase.groupBy({
    by: ['outcome'],
    _count: true,
  });
  byOutcome.forEach((r) =>
    console.log(`  ${(r.outcome ?? '(null)').padEnd(15)} ${r._count}`),
  );

  console.log('\n=== APPLICATION DATE DISTRIBUTION (by year) ===');
  const datedCases = await prisma.extractedCase.findMany({
    where: { applicationDate: { not: null } },
    select: { applicationDate: true },
  });
  const yearCounts: Record<string, number> = {};
  for (const c of datedCases) {
    const y = c.applicationDate!.getUTCFullYear().toString();
    yearCounts[y] = (yearCounts[y] ?? 0) + 1;
  }
  const sortedYears = Object.keys(yearCounts).sort();
  for (const y of sortedYears) {
    console.log(`  ${y}: ${yearCounts[y]}`);
  }
  const withNoDate = await prisma.extractedCase.count({
    where: { applicationDate: null },
  });
  console.log(`  (no applicationDate parsed): ${withNoDate}`);

  console.log('\n=== POST DATE DISTRIBUTION (by year — when posted to forum) ===');
  const postedPosts = await prisma.post.findMany({
    where: { postedAt: { not: null } },
    select: { postedAt: true },
  });
  const postYearCounts: Record<string, number> = {};
  for (const p of postedPosts) {
    const y = p.postedAt!.getUTCFullYear().toString();
    postYearCounts[y] = (postYearCounts[y] ?? 0) + 1;
  }
  Object.keys(postYearCounts)
    .sort()
    .forEach((y) => console.log(`  ${y}: ${postYearCounts[y]}`));

  console.log('\n=== SAMPLE 5 MOST RECENT POSTS ===');
  const recentPosts = await prisma.post.findMany({
    orderBy: { postedAt: 'desc' },
    take: 5,
    select: {
      postedAt: true,
      thread: { select: { title: true } },
      extractedCase: {
        select: {
          applicationRoute: true,
          applicationDate: true,
          decisionDate: true,
          serviceTier: true,
          biometricsLocation: true,
          confidence: true,
        },
      },
    },
  });
  for (const p of recentPosts) {
    console.log(`  posted=${p.postedAt?.toISOString().slice(0, 10)} thread="${p.thread.title}"`);
    if (p.extractedCase) {
      console.log(
        `    route=${p.extractedCase.applicationRoute ?? '?'}  applied=${p.extractedCase.applicationDate?.toISOString().slice(0, 10) ?? '?'}  decided=${p.extractedCase.decisionDate?.toISOString().slice(0, 10) ?? '?'}  tier=${p.extractedCase.serviceTier ?? '?'}  bio=${p.extractedCase.biometricsLocation ?? '?'}  conf=${p.extractedCase.confidence}`,
      );
    } else {
      console.log(`    (no case extracted)`);
    }
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
