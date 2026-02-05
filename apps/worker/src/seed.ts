/**
 * Seed script to initialize the database with the immigrationboards source
 * 
 * Run with: pnpm --filter @ilr/worker run seed
 */

import { prisma } from '@ilr/db';

async function seed() {
  console.log('Seeding database...');

  // Create the immigrationboards source
  const source = await prisma.sourceForum.upsert({
    where: { name: 'immigrationboards' },
    update: {
      displayName: 'Immigration Boards UK',
      baseUrl: 'https://www.immigrationboards.com',
      type: 'playwright',
      config: {
        threadUrl: 'https://www.immigrationboards.com/viewtopic.php?t=231555',
        postsPerPage: 25,
      },
      isActive: true,
    },
    create: {
      name: 'immigrationboards',
      displayName: 'Immigration Boards UK',
      baseUrl: 'https://www.immigrationboards.com',
      type: 'playwright',
      config: {
        threadUrl: 'https://www.immigrationboards.com/viewtopic.php?t=231555',
        postsPerPage: 25,
      },
      isActive: true,
    },
  });

  console.log('Created/updated source:', source.name);

  // Create a test thread
  const thread = await prisma.thread.upsert({
    where: {
      sourceId_externalId: {
        sourceId: source.id,
        externalId: 't231555',
      },
    },
    update: {
      title: 'ILR TIMELINES- SET(O) SET(F) SET(M)',
      url: 'https://www.immigrationboards.com/viewtopic.php?t=231555',
    },
    create: {
      sourceId: source.id,
      externalId: 't231555',
      title: 'ILR TIMELINES- SET(O) SET(F) SET(M)',
      url: 'https://www.immigrationboards.com/viewtopic.php?t=231555',
      postedAt: new Date('2017-05-21'),
    },
  });

  console.log('Created/updated thread:', thread.title);
  console.log('Seed completed!');
}

seed()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
