/**
 * Kaplan–Meier non-parametric survival estimator.
 *
 * For ILR Tracker, "survival" means "still waiting for a decision". Given a
 * set of cases where some are decided (event observed) and some are still
 * pending (right-censored), KM gives us:
 *
 *   S(t) = product over t_i <= t of (1 - d_i / n_i)
 *
 * where:
 *   t_i  : i-th distinct event time (in days)
 *   d_i  : number of decisions on day t_i
 *   n_i  : number of cases at risk just before day t_i
 *
 * From S(t) we derive:
 *   median wait      = first t where S(t) <= 0.5
 *   percentiles      = first t where S(t) <= (1 - p)
 *   "decided by now" = 1 - S(t)
 *
 * Censoring works correctly: a pending case at day d contributes to the
 * at-risk count up to day d, then leaves the risk set without an event.
 * This is exactly what we want — pending cases inform the curve up until
 * "today" without being counted as "long" or "short".
 *
 * The implementation is intentionally pure (no Date math, no DB) so it can
 * be unit-tested against textbook examples.
 */

export interface KmInput {
  /** Duration in days since application. Must be > 0. */
  durationDays: number;
  /**
   * true  = decision observed at `durationDays`
   * false = still pending at `durationDays` (right-censored)
   */
  eventObserved: boolean;
}

export interface KmPoint {
  /** Day at which this step of the curve takes effect. */
  day: number;
  /** Survival probability S(day): fraction still waiting at this day. */
  survival: number;
  /** Number at risk just before this day (before any events on this day). */
  atRisk: number;
  /** Number of decisions on this day. */
  events: number;
}

export interface KmResult {
  /** Number of input cases (decided + censored). */
  n: number;
  /** Number of decided (event=true) cases. */
  decidedCount: number;
  /** Number of censored (pending) cases. */
  censoredCount: number;
  /**
   * Step function points. Always begins with a point at day 0 with
   * survival=1 and atRisk=n. Points after that exist only on days where
   * an event occurred. Censoring days are NOT in the points but reduce
   * the at-risk count for subsequent event days.
   */
  points: KmPoint[];
}

/**
 * Compute the Kaplan–Meier estimator over a set of (duration, event) pairs.
 *
 * Edge cases:
 * - Empty input → n=0, points=[].
 * - All-censored input → curve stays at S=1 (we never observe an event,
 *   so the curve is non-decreasing only at censoring boundaries which we
 *   don't emit; the only point is day=0, survival=1).
 * - Ties between events and censoring on the same day are handled with
 *   the standard convention: events occur first, then censoring.
 */
export function kaplanMeier(inputs: KmInput[]): KmResult {
  if (inputs.length === 0) {
    return { n: 0, decidedCount: 0, censoredCount: 0, points: [] };
  }

  // Filter out invalid durations defensively.
  const cleaned = inputs.filter((i) => Number.isFinite(i.durationDays) && i.durationDays > 0);

  const n = cleaned.length;
  let decidedCount = 0;
  let censoredCount = 0;

  // Group by day. For each day we need: number of events and number of censored.
  // Map<day, { events: number; censored: number }>
  const dayBuckets = new Map<number, { events: number; censored: number }>();

  for (const input of cleaned) {
    const day = Math.round(input.durationDays);
    let bucket = dayBuckets.get(day);
    if (!bucket) {
      bucket = { events: 0, censored: 0 };
      dayBuckets.set(day, bucket);
    }
    if (input.eventObserved) {
      bucket.events++;
      decidedCount++;
    } else {
      bucket.censored++;
      censoredCount++;
    }
  }

  const sortedDays = Array.from(dayBuckets.keys()).sort((a, b) => a - b);

  const points: KmPoint[] = [{ day: 0, survival: 1, atRisk: n, events: 0 }];
  let atRisk = n;
  let survival = 1;

  for (const day of sortedDays) {
    const bucket = dayBuckets.get(day)!;

    if (bucket.events > 0) {
      // Standard KM step: S_new = S_old * (1 - d/n)
      survival = survival * (1 - bucket.events / atRisk);
      points.push({
        day,
        survival,
        atRisk,
        events: bucket.events,
      });
    }

    // Both events and censoring on this day reduce the risk set for subsequent days.
    atRisk -= bucket.events + bucket.censored;
  }

  return { n, decidedCount, censoredCount, points };
}

/**
 * Get the day at which the survival curve first crosses (1 - p).
 * For example, kmPercentile(km, 0.5) is the median wait time.
 *
 * Returns null if the curve never crosses that level (typical when many
 * cases are still pending — e.g., we may never observe S(t) <= 0.5 if half
 * the cohort is still waiting).
 */
export function kmPercentile(km: KmResult, p: number): number | null {
  if (km.n === 0) return null;
  if (p <= 0) return 0;
  if (p > 1) return null;

  const threshold = 1 - p;

  for (const point of km.points) {
    if (point.survival <= threshold) {
      return point.day;
    }
  }

  return null;
}

/**
 * Fraction of comparable cases that had a decision by a given day.
 * Equals 1 - S(day). Useful for "you're at day 73; X% of comparable cases
 * had a decision by now".
 */
export function kmDecidedByDayFraction(km: KmResult, day: number): number {
  if (km.n === 0) return 0;
  if (day <= 0) return 0;

  // Find S(day) — the survival at the largest curve point <= day.
  let survivalAtDay = 1;
  for (const point of km.points) {
    if (point.day <= day) {
      survivalAtDay = point.survival;
    } else {
      break;
    }
  }

  return Math.max(0, Math.min(1, 1 - survivalAtDay));
}

/**
 * Conditional median additional wait given the user has been waiting `currentDay` days.
 * Computes the smallest k such that S(currentDay + k) <= S(currentDay) / 2.
 *
 * Returns null if no such k exists in the observed curve (i.e., not enough
 * decided cases beyond `currentDay` to estimate the conditional median).
 */
export function kmConditionalMedian(km: KmResult, currentDay: number): number | null {
  if (km.n === 0) return null;

  // Find S(currentDay).
  let survivalNow = 1;
  for (const point of km.points) {
    if (point.day <= currentDay) {
      survivalNow = point.survival;
    } else {
      break;
    }
  }

  // If the user is past the last observed event, we can't estimate.
  if (survivalNow <= 0) return null;

  const target = survivalNow / 2;

  for (const point of km.points) {
    if (point.day > currentDay && point.survival <= target) {
      return point.day - currentDay;
    }
  }

  return null;
}
