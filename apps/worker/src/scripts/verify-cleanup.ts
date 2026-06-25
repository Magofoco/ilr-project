/**
 * Post-reextract verification: did the v1.5 nullify() fix actually clean up
 * the stale fields? Reports extractor-version coverage, biometricsLocation
 * distribution, postedAt coverage, and cohort-window counts.
 */
import { prisma } from '@ilr/db';
import { EXTRACTOR_VERSION } from '../extraction/extractor.js';

async function main() {
  console.log(`=== LIVE EXTRACTOR_VERSION = ${EXTRACTOR_VERSION} ===\n`);

  console.log('=== EXTRACTOR VERSION COVERAGE ===');
  const versionStats = await prisma.extractedCase.groupBy({
    by: ['extractorVersion'],
    _count: true,
  });
  for (const v of versionStats) {
    console.log(`  ${v.extractorVersion ?? '(null)'}: ${v._count}`);
  }

  console.log('\n=== BIOMETRICS LOCATION ===');
  const totalCases = await prisma.extractedCase.count();
  const withBio = await prisma.extractedCase.count({
    where: { biometricsLocation: { not: null } },
  });
  console.log(`  total cases:          ${totalCases}`);
  console.log(`  with biometricsLocation: ${withBio} (${((withBio / totalCases) * 100).toFixed(1)}%)`);
  console.log(`  NULL biometricsLocation:  ${totalCases - withBio}`);

  console.log('\n  Top 20 biometricsLocation values:');
  const topLocs = await prisma.extractedCase.groupBy({
    by: ['biometricsLocation'],
    where: { biometricsLocation: { not: null } },
    _count: { biometricsLocation: true },
    orderBy: { _count: { biometricsLocation: 'desc' } },
    take: 20,
  });
  for (const loc of topLocs) {
    console.log(`    ${String(loc._count.biometricsLocation).padStart(4)}  ${loc.biometricsLocation}`);
  }

  // Sanity: are any of the known-bad values still in there?
  const knownNoise = [
    'Idv App',
    'Saturday',
    'Idv',
    'Tls Leeds',
    'Via Idv App',
    'In-person Biometrics At Ukvcas Service Point',
    'Opted Out Of App, Submitted Biometrics In Croydon',
  ];
  const stillNoisy = await prisma.extractedCase.findMany({
    where: { biometricsLocation: { in: knownNoise } },
    select: { biometricsLocation: true },
  });
  console.log(`\n  Known-noisy values remaining: ${stillNoisy.length}`);
  if (stillNoisy.length > 0) {
    const grouped = new Map<string, number>();
    for (const c of stillNoisy) {
      const k = c.biometricsLocation ?? '(null)';
      grouped.set(k, (grouped.get(k) ?? 0) + 1);
    }
    for (const [k, n] of grouped) console.log(`    ${String(n).padStart(4)}  ${k}`);
  }

  console.log('\n=== POSTED AT COVERAGE ===');
  const totalPosts = await prisma.post.count();
  const withPosted = await prisma.post.count({ where: { postedAt: { not: null } } });
  console.log(`  total posts:        ${totalPosts}`);
  console.log(`  with postedAt:      ${withPosted} (${((withPosted / totalPosts) * 100).toFixed(1)}%)`);
  console.log(`  NULL postedAt:      ${totalPosts - withPosted}`);

  console.log('\n=== COHORT WINDOW (decision/application within last 730d) ===');
  const cutoff = new Date(Date.now() - 730 * 24 * 60 * 60 * 1000);
  const inWindowDecision = await prisma.extractedCase.count({
    where: { decisionDate: { gte: cutoff } },
  });
  const inWindowApplication = await prisma.extractedCase.count({
    where: { applicationDate: { gte: cutoff } },
  });
  console.log(`  decided in last 730d:    ${inWindowDecision}`);
  console.log(`  applied in last 730d:    ${inWindowApplication}`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
