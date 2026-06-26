/**
 * Lightweight assertion-based tests for the per-applicant case merge.
 *
 * Run with: pnpm --filter @ilr/worker run test:merge
 *
 * Each TEST has an input of per-post `MergeableCase` rows and expectations
 * about the merged output. Exit code 1 on any failure (CI-friendly).
 */

import { mergeCases, caseKey, type MergeableCase, type MergedCase } from '@ilr/shared';

const URL_DEEDEE = 'https://www.immigrationboards.com/viewtopic.php?t=231555';

function d(iso: string): Date {
  return new Date(iso);
}

function basePost(overrides: Partial<MergeableCase> & { id: string }): MergeableCase {
  return {
    threadId: 't1',
    authorName: 'deedee44',
    postedAt: null,
    sourceUrl: URL_DEEDEE,
    applicationRoute: null,
    applicationType: null,
    serviceTier: null,
    applicationDate: null,
    biometricsDate: null,
    docsRequestedDate: null,
    docsSubmittedDate: null,
    decisionDate: null,
    biometricsLocation: null,
    decisionCenter: null,
    applicantNationality: null,
    applicantNationalityCode: null,
    outcome: null,
    isPending: false,
    confidence: 0.4,
    ...overrides,
  };
}

interface TestCase {
  name: string;
  input: MergeableCase[];
  expect: (merged: MergedCase[]) => string[]; // returns array of failure messages
}

const TESTS: TestCase[] = [
  // --------------------------------------------------------------------
  // The deedee44 scenario: 5 posts, one applicant, decision only in the
  // last post. The whole point of this exercise.
  // --------------------------------------------------------------------
  {
    name: 'deedee44 — 5 posts collapse to 1 approved case',
    input: [
      basePost({
        id: 'p1', postedAt: d('2018-04-01'),
        applicationRoute: 'SET(O)', applicationDate: d('2018-03-13'),
        biometricsDate: d('2018-03-25'),
        outcome: 'pending', isPending: true,
      }),
      basePost({
        id: 'p2', postedAt: d('2018-05-01'),
        applicationRoute: 'SET(O)', applicationDate: d('2018-03-13'),
        biometricsDate: d('2018-03-25'),
        outcome: 'pending', isPending: true,
      }),
      basePost({
        id: 'p3', postedAt: d('2018-06-01'),
        applicationRoute: '10-year', applicationDate: d('2018-03-13'),
        biometricsDate: d('2018-03-25'),
        outcome: 'pending', isPending: true,
      }),
      basePost({
        id: 'p4', postedAt: d('2018-07-01'),
        applicationRoute: '10-year', applicationDate: d('2018-03-13'),
        biometricsDate: d('2018-03-25'),
        outcome: 'pending', isPending: true,
      }),
      basePost({
        id: 'p5', postedAt: d('2018-09-01'),
        applicationRoute: '10-year', applicationDate: d('2018-03-13'),
        biometricsDate: d('2018-03-25'),
        decisionDate: d('2018-08-31'),
        outcome: 'approved', isPending: false,
        confidence: 0.7,
      }),
    ],
    expect: (m) => {
      const out: string[] = [];
      if (m.length !== 1) out.push(`expected 1 merged case, got ${m.length}`);
      const c = m[0]!;
      if (c.applicationRoute !== '10-year')
        out.push(`route: expected '10-year' (last non-null), got ${c.applicationRoute}`);
      if (c.applicationDate?.toISOString().slice(0, 10) !== '2018-03-13')
        out.push(`applicationDate: expected 2018-03-13, got ${c.applicationDate?.toISOString()}`);
      if (c.decisionDate?.toISOString().slice(0, 10) !== '2018-08-31')
        out.push(`decisionDate: expected 2018-08-31, got ${c.decisionDate?.toISOString()}`);
      if (c.outcome !== 'approved') out.push(`outcome: expected 'approved', got ${c.outcome}`);
      if (c.isPending !== false) out.push(`isPending: expected false, got ${c.isPending}`);
      if (c.confidence !== 0.7) out.push(`confidence: expected 0.7 (max), got ${c.confidence}`);
      if (c.contributingPostCount !== 5)
        out.push(`contributingPostCount: expected 5, got ${c.contributingPostCount}`);
      if (c.sourceUrls.length !== 1)
        out.push(`sourceUrls: expected 1 (all dedup), got ${c.sourceUrls.length}`);
      return out;
    },
  },

  // --------------------------------------------------------------------
  // Two different authors in the same thread → 2 cases.
  // --------------------------------------------------------------------
  {
    name: 'Different authors, same thread → separate cases',
    input: [
      basePost({ id: 'a1', authorName: 'alice', applicationDate: d('2026-01-01') }),
      basePost({ id: 'a2', authorName: 'alice', applicationDate: d('2026-01-01') }),
      basePost({ id: 'b1', authorName: 'bob', applicationDate: d('2026-01-15') }),
    ],
    expect: (m) => {
      const out: string[] = [];
      if (m.length !== 2) out.push(`expected 2 cases, got ${m.length}`);
      const alice = m.find((x) => x.authorName === 'alice');
      const bob = m.find((x) => x.authorName === 'bob');
      if (!alice) out.push('alice case missing');
      if (!bob) out.push('bob case missing');
      if (alice && alice.contributingPostCount !== 2)
        out.push(`alice should have 2 contributions, got ${alice.contributingPostCount}`);
      if (bob && bob.contributingPostCount !== 1)
        out.push(`bob should have 1 contribution, got ${bob.contributingPostCount}`);
      return out;
    },
  },

  // --------------------------------------------------------------------
  // Same author across DIFFERENT threads → separate cases.
  // --------------------------------------------------------------------
  {
    name: 'Same author, different threads → separate cases',
    input: [
      basePost({ id: 't1p1', threadId: 't1', applicationDate: d('2026-01-01') }),
      basePost({ id: 't2p1', threadId: 't2', applicationDate: d('2026-01-15') }),
    ],
    expect: (m) => (m.length === 2 ? [] : [`expected 2 cases, got ${m.length}`]),
  },

  // --------------------------------------------------------------------
  // NULL author rows are NEVER merged. Each is its own case.
  // --------------------------------------------------------------------
  {
    name: 'NULL author → never merged',
    input: [
      basePost({ id: 'n1', authorName: null, applicationDate: d('2024-01-01') }),
      basePost({ id: 'n2', authorName: null, applicationDate: d('2024-01-01') }),
      basePost({ id: 'n3', authorName: null, applicationDate: d('2024-01-01') }),
    ],
    expect: (m) => (m.length === 3 ? [] : [`expected 3 singleton cases, got ${m.length}`]),
  },

  // --------------------------------------------------------------------
  // Same author, same thread, but applicationDate values >365 days apart
  // → treated as separate cases (the "second visa in the same thread"
  //   scenario).
  // --------------------------------------------------------------------
  {
    name: 'Same author + >365d application gap → separate cases',
    input: [
      basePost({ id: 'first', applicationDate: d('2020-01-01') }),
      basePost({ id: 'second', applicationDate: d('2026-01-01') }),
    ],
    expect: (m) => (m.length === 2 ? [] : [`expected 2 cases for distinct applications, got ${m.length}`]),
  },

  // --------------------------------------------------------------------
  // applicationDate fills in late: rows without a date should still merge
  // with later rows that DO carry the same author + thread, as long as
  // they fall in the same 365-day bucket once known. The "null bucket"
  // catches dateless rows together.
  //
  // NOTE: this is intentionally lossy at the edge — a dateless first post
  // followed by a dated second post will produce 2 separate cases under
  // this rule. The expected workflow (extractor v1.7) is that the first
  // post always carries the application date, so this is rare. We pin the
  // behavior down here so it can't regress silently.
  // --------------------------------------------------------------------
  {
    name: 'Dateless row + dated row → separate (intentional)',
    input: [
      basePost({ id: 'no_date', applicationDate: null, outcome: 'pending', isPending: true }),
      basePost({
        id: 'has_date',
        applicationDate: d('2026-02-01'),
        decisionDate: d('2026-03-01'),
        outcome: 'approved',
      }),
    ],
    expect: (m) => (m.length === 2 ? [] : [`expected 2 cases, got ${m.length}`]),
  },

  // --------------------------------------------------------------------
  // Outcome derivation: any approval wins; pending beats unknown.
  // --------------------------------------------------------------------
  {
    name: 'Outcome: approved is terminal once seen',
    input: [
      basePost({ id: 'r1', postedAt: d('2026-01-01'), applicationDate: d('2025-12-01'), outcome: 'pending' }),
      basePost({
        id: 'r2', postedAt: d('2026-02-01'),
        applicationDate: d('2025-12-01'), decisionDate: d('2026-01-25'),
        outcome: 'approved',
      }),
      // A late "pending" copy-paste shouldn't undo the approval.
      basePost({ id: 'r3', postedAt: d('2026-03-01'), applicationDate: d('2025-12-01'), outcome: 'pending' }),
    ],
    expect: (m) => {
      const out: string[] = [];
      if (m.length !== 1) out.push(`expected 1 case, got ${m.length}`);
      if (m[0]?.outcome !== 'approved') out.push(`expected approved, got ${m[0]?.outcome}`);
      if (m[0]?.isPending !== false) out.push(`expected isPending=false, got ${m[0]?.isPending}`);
      return out;
    },
  },

  {
    name: 'Outcome: all pending stays pending',
    input: [
      basePost({ id: 'p1', applicationDate: d('2026-01-01'), outcome: 'pending', isPending: true }),
      basePost({ id: 'p2', applicationDate: d('2026-01-01'), outcome: 'pending', isPending: true }),
    ],
    expect: (m) => {
      const out: string[] = [];
      if (m.length !== 1) out.push(`expected 1 case, got ${m.length}`);
      if (m[0]?.outcome !== 'pending') out.push(`expected pending, got ${m[0]?.outcome}`);
      if (m[0]?.isPending !== true) out.push(`expected isPending=true, got ${m[0]?.isPending}`);
      if (m[0]?.decisionDate !== null) out.push(`expected null decision, got ${m[0]?.decisionDate}`);
      return out;
    },
  },

  // --------------------------------------------------------------------
  // Source URL provenance: multiple distinct URLs are preserved and deduped.
  // --------------------------------------------------------------------
  {
    name: 'sourceUrls: preserved and deduped',
    input: [
      basePost({ id: 's1', sourceUrl: 'https://example.com/a', applicationDate: d('2026-01-01') }),
      basePost({ id: 's2', sourceUrl: 'https://example.com/a', applicationDate: d('2026-01-01') }),
      basePost({ id: 's3', sourceUrl: 'https://example.com/b', applicationDate: d('2026-01-01') }),
    ],
    expect: (m) => {
      const c = m[0];
      if (!c) return ['no case'];
      if (c.sourceUrls.length !== 2) return [`expected 2 unique URLs, got ${c.sourceUrls.length}`];
      if (c.contributingPostCount !== 3)
        return [`expected 3 contributing posts, got ${c.contributingPostCount}`];
      return [];
    },
  },

  // --------------------------------------------------------------------
  // caseKey is stable for the same input.
  // --------------------------------------------------------------------
  {
    name: 'caseKey: stable across calls',
    input: [],
    expect: () => {
      const row = basePost({ id: 'x', applicationDate: d('2026-02-15') });
      const k1 = caseKey(row);
      const k2 = caseKey(row);
      const k3 = caseKey({ ...row, id: 'different-id' });
      const out: string[] = [];
      if (k1 !== k2) out.push(`caseKey not stable: ${k1} vs ${k2}`);
      if (k1 !== k3) out.push(`caseKey should ignore id field for non-null author`);
      return out;
    },
  },
];

let totalFailures = 0;

console.log(`Case-merge tests — ${TESTS.length} cases\n`);
console.log('='.repeat(70));

for (const test of TESTS) {
  const merged = mergeCases(test.input);
  const failures = test.expect(merged);
  if (failures.length === 0) {
    console.log(`  PASS  ${test.name}`);
  } else {
    totalFailures += failures.length;
    console.log(`  FAIL  ${test.name}`);
    for (const msg of failures) console.log(`        ${msg}`);
  }
}

console.log('='.repeat(70));

if (totalFailures > 0) {
  console.log(`${totalFailures} assertion failure(s).`);
  process.exit(1);
} else {
  console.log(`All ${TESTS.length} tests passed.`);
}
