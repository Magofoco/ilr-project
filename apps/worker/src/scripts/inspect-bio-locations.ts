/**
 * Diagnostic for the question "are we under-capturing biometrics locations?"
 *
 * 1. Count exact distinct values currently in the DB.
 * 2. Find posts that mention biometrics + a known UK city in free text but
 *    yielded NULL biometricsLocation — these are the misses.
 * 3. Show short snippets so we can see what pattern the forum uses.
 */
import { prisma } from '@ilr/db';

const UK_CITIES = [
  'Croydon',
  'Manchester',
  'Birmingham',
  'Mark Lane',
  'Reading',
  'Cardiff',
  'Glasgow',
  'Belfast',
  'Edinburgh',
  'Liverpool',
  'Sheffield',
  'Bristol',
  'Nottingham',
  'Newcastle',
  'Leeds',
  'Hounslow',
  'Wandsworth',
  'Wakefield',
  'Peterborough',
  'Guildford',
  'Solihull',
  'Coventry',
  'Southampton',
  'Brighton',
  'Cambridge',
  'Oxford',
  'Norwich',
  'Aberdeen',
  'Dundee',
  'Swansea',
  'Plymouth',
  'Leicester',
  'Hull',
  'Stoke',
  'Bolton',
  'Bradford',
  'Stratford',
  'Wembley',
  'Romford',
  'Watford',
  'Slough',
  'Luton',
  'Milton Keynes',
  'Northampton',
  'Derby',
  'Wolverhampton',
  'Stoke-on-Trent',
  'Preston',
  'Sunderland',
  'Middlesbrough',
  'Carlisle',
  'Lincoln',
  'York',
  'Doncaster',
  'Chester',
  'Worcester',
  'Bath',
  'Exeter',
  'Sopra Steria',
  'Gee Street',
];

async function main() {
  console.log('=== EXACT DISTINCT biometricsLocation VALUES ===');
  const distinct = await prisma.extractedCase.groupBy({
    by: ['biometricsLocation'],
    where: { biometricsLocation: { not: null } },
    _count: { biometricsLocation: true },
    orderBy: { _count: { biometricsLocation: 'desc' } },
  });
  console.log(`  Distinct values: ${distinct.length}`);
  for (const row of distinct) {
    console.log(`    ${String(row._count.biometricsLocation).padStart(4)}  ${row.biometricsLocation}`);
  }

  console.log('\n=== POSTS THAT MENTION BIOMETRICS ===');
  const bioPosts = await prisma.post.findMany({
    where: { content: { contains: 'biometric', mode: 'insensitive' } },
    select: { id: true, content: true, extractedCase: { select: { biometricsLocation: true } } },
  });
  console.log(`  Total posts mentioning "biometric": ${bioPosts.length}`);

  const withLoc = bioPosts.filter((p) => p.extractedCase?.biometricsLocation != null).length;
  const withoutLoc = bioPosts.length - withLoc;
  console.log(`  Of those, with biometricsLocation set: ${withLoc} (${((withLoc / bioPosts.length) * 100).toFixed(1)}%)`);
  console.log(`  Of those, biometricsLocation is NULL:  ${withoutLoc} (${((withoutLoc / bioPosts.length) * 100).toFixed(1)}%)`);

  console.log('\n=== NULL POSTS THAT MENTION A KNOWN UK CITY ===');
  const nullBioMentioningCity: Array<{ city: string; postId: string; snippet: string }> = [];
  for (const post of bioPosts) {
    if (post.extractedCase?.biometricsLocation != null) continue;
    for (const city of UK_CITIES) {
      const re = new RegExp(`\\b${city}\\b`, 'i');
      if (re.test(post.content)) {
        const idx = post.content.search(re);
        const snippet = post.content
          .slice(Math.max(0, idx - 60), Math.min(post.content.length, idx + 80))
          .replace(/\s+/g, ' ');
        nullBioMentioningCity.push({ city, postId: post.id, snippet });
        break;
      }
    }
  }
  console.log(`  Posts where biometrics is mentioned AND a city name appears, but we extracted nothing: ${nullBioMentioningCity.length}`);

  console.log('\n  Top 20 misses (snippet around the city name):');
  for (const m of nullBioMentioningCity.slice(0, 20)) {
    console.log(`  [${m.city}]`);
    console.log(`    …${m.snippet}…`);
  }

  console.log('\n=== CITY FREQUENCY IN MISSES ===');
  const cityHits = new Map<string, number>();
  for (const m of nullBioMentioningCity) cityHits.set(m.city, (cityHits.get(m.city) ?? 0) + 1);
  const sorted = [...cityHits.entries()].sort((a, b) => b[1] - a[1]);
  for (const [c, n] of sorted) console.log(`    ${String(n).padStart(4)}  ${c}`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
