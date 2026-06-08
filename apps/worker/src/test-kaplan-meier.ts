/**
 * Kaplan–Meier sanity tests.
 *
 * Run with: pnpm --filter @ilr/worker run test:km
 *
 * The reference values below come from a textbook example
 * (Kaplan & Meier 1958; identical numerical example used in many stats texts):
 *
 *   Patients (durations in days, * = censored):
 *     6, 6, 6, 6*, 7, 9*, 10, 10*, 11*, 13, 16, 17*, 19*, 20*, 22, 23, 25*, 32*,
 *     32*, 34*, 35*
 *
 *   Resulting KM curve (key values):
 *     S(6)  = 0.857
 *     S(7)  = 0.807
 *     S(10) = 0.753
 *     S(13) = 0.690
 *     S(16) = 0.628
 *     S(22) = 0.538
 *     S(23) = 0.448
 *
 * We don't reproduce every step here; we check the headline values to within
 * 1e-3 plus the percentile / decided-by-day helpers on a constructed example.
 */

import {
  kaplanMeier,
  kmPercentile,
  kmDecidedByDayFraction,
  kmConditionalMedian,
  type KmInput,
} from '@ilr/shared';

let failures = 0;
const tolerance = 1e-3;

function assertClose(actual: number, expected: number, label: string) {
  if (Math.abs(actual - expected) > tolerance) {
    console.log(`  FAIL  ${label}: expected ~${expected}, got ${actual}`);
    failures++;
  } else {
    console.log(`  PASS  ${label} (${actual.toFixed(4)})`);
  }
}

function assertEqual<T>(actual: T, expected: T, label: string) {
  if (actual !== expected) {
    console.log(`  FAIL  ${label}: expected ${expected}, got ${actual}`);
    failures++;
  } else {
    console.log(`  PASS  ${label} (${String(actual)})`);
  }
}

console.log('Kaplan–Meier sanity tests\n' + '='.repeat(60));

// ----- Test 1: Kaplan & Meier (1958) reference -----
console.log('\nTest 1: K&M textbook example');
const km1Inputs: KmInput[] = [
  { durationDays: 6, eventObserved: true },
  { durationDays: 6, eventObserved: true },
  { durationDays: 6, eventObserved: true },
  { durationDays: 6, eventObserved: false },
  { durationDays: 7, eventObserved: true },
  { durationDays: 9, eventObserved: false },
  { durationDays: 10, eventObserved: true },
  { durationDays: 10, eventObserved: false },
  { durationDays: 11, eventObserved: false },
  { durationDays: 13, eventObserved: true },
  { durationDays: 16, eventObserved: true },
  { durationDays: 17, eventObserved: false },
  { durationDays: 19, eventObserved: false },
  { durationDays: 20, eventObserved: false },
  { durationDays: 22, eventObserved: true },
  { durationDays: 23, eventObserved: true },
  { durationDays: 25, eventObserved: false },
  { durationDays: 32, eventObserved: false },
  { durationDays: 32, eventObserved: false },
  { durationDays: 34, eventObserved: false },
  { durationDays: 35, eventObserved: false },
];

const km1 = kaplanMeier(km1Inputs);
assertEqual(km1.n, 21, 'n');
assertEqual(km1.decidedCount, 9, 'decidedCount');
assertEqual(km1.censoredCount, 12, 'censoredCount');

// Find S at specific days (last point with day <= target).
function survivalAt(km: ReturnType<typeof kaplanMeier>, day: number): number {
  let s = 1;
  for (const p of km.points) {
    if (p.day <= day) s = p.survival;
    else break;
  }
  return s;
}

assertClose(survivalAt(km1, 6), 0.857, 'S(6)');
assertClose(survivalAt(km1, 7), 0.807, 'S(7)');
assertClose(survivalAt(km1, 10), 0.753, 'S(10)');
assertClose(survivalAt(km1, 13), 0.690, 'S(13)');
assertClose(survivalAt(km1, 16), 0.628, 'S(16)');
assertClose(survivalAt(km1, 22), 0.538, 'S(22)');
assertClose(survivalAt(km1, 23), 0.448, 'S(23)');

// ----- Test 2: All decided, no censoring (reduces to empirical CDF) -----
console.log('\nTest 2: All decided — empirical CDF case');
const km2 = kaplanMeier([
  { durationDays: 10, eventObserved: true },
  { durationDays: 20, eventObserved: true },
  { durationDays: 30, eventObserved: true },
  { durationDays: 40, eventObserved: true },
]);
// After day 10: S = 3/4
// After day 20: S = 2/4 = 0.5
// After day 30: S = 1/4
// After day 40: S = 0
assertClose(survivalAt(km2, 10), 0.75, 'S(10)');
assertClose(survivalAt(km2, 20), 0.5, 'S(20)');
assertClose(survivalAt(km2, 30), 0.25, 'S(30)');
assertClose(survivalAt(km2, 40), 0.0, 'S(40)');
assertEqual(kmPercentile(km2, 0.5), 20, 'median');
assertEqual(kmPercentile(km2, 0.25), 10, 'P25');
assertEqual(kmPercentile(km2, 0.75), 30, 'P75');

// ----- Test 3: All censored — curve never decreases -----
console.log('\nTest 3: All censored');
const km3 = kaplanMeier([
  { durationDays: 50, eventObserved: false },
  { durationDays: 100, eventObserved: false },
]);
assertClose(survivalAt(km3, 100), 1.0, 'S(100) all censored');
assertEqual(kmPercentile(km3, 0.5), null, 'median (all censored)');

// ----- Test 4: Empty input -----
console.log('\nTest 4: Empty input');
const km4 = kaplanMeier([]);
assertEqual(km4.n, 0, 'n=0');
assertEqual(kmPercentile(km4, 0.5), null, 'median empty');

// ----- Test 5: kmDecidedByDayFraction -----
console.log('\nTest 5: kmDecidedByDayFraction');
const km5 = kaplanMeier([
  { durationDays: 10, eventObserved: true },
  { durationDays: 20, eventObserved: true },
  { durationDays: 30, eventObserved: true },
  { durationDays: 40, eventObserved: true },
]);
assertClose(kmDecidedByDayFraction(km5, 0), 0, 'decided-by(0)');
assertClose(kmDecidedByDayFraction(km5, 10), 0.25, 'decided-by(10)');
assertClose(kmDecidedByDayFraction(km5, 20), 0.5, 'decided-by(20)');
assertClose(kmDecidedByDayFraction(km5, 100), 1.0, 'decided-by(100)');

// ----- Test 6: kmConditionalMedian -----
console.log('\nTest 6: kmConditionalMedian');
// Given still waiting at day 10 (S=0.75), the conditional median is the
// smallest k such that S(10+k) <= 0.75/2 = 0.375.
// S(20) = 0.5 (not yet), S(30) = 0.25 (yes) → conditional median additional wait = 30 - 10 = 20.
assertEqual(kmConditionalMedian(km5, 10), 20, 'conditional median at day 10');

// At day 20 (S=0.5), conditional median is k s.t. S(20+k) <= 0.25.
// S(30) = 0.25 → conditional median = 30 - 20 = 10.
assertEqual(kmConditionalMedian(km5, 20), 10, 'conditional median at day 20');

// At day 40 (S=0), no further decisions are estimable.
assertEqual(kmConditionalMedian(km5, 40), null, 'conditional median past last event');

console.log('\n' + '='.repeat(60));
if (failures > 0) {
  console.log(`${failures} assertion failure(s).`);
  process.exit(1);
}
console.log(`All Kaplan–Meier tests passed.`);
