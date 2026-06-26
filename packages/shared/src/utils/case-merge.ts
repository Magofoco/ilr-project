/**
 * Per-applicant case merge.
 *
 * One forum user filing one ILR application typically posts multiple times
 * in the same thread (initial timeline, biometrics-done update, "I got my
 * BRP!" update). Each post matches the extractor and becomes its own
 * `ExtractedCase` row — so a single applicant inflates the cohort 2–5×, and
 * the decision date that only appears in the last post is leaked away from
 * the earlier rows (they're treated as still pending).
 *
 * This helper folds N per-post extractions for the same `(thread, author)`
 * into a single merged case using deterministic field-wise rules. See
 * `docs/case-merge-design.md` for the full design and rationale.
 *
 * The functions here are intentionally pure — no DB, no Date.now(), no I/O.
 * That's so the API can call them on its loaded cohort and the worker can
 * unit-test them against textbook fixtures.
 */

const DAY_MS = 1000 * 60 * 60 * 24;

/**
 * Width of the "second-application" bucket. Two posts by the same forum
 * user in the same thread whose `applicationDate` values are more than this
 * many days apart are treated as DIFFERENT cases (the user came back years
 * later to do FLR/Naturalisation in the same thread, etc.). Rationale:
 * ILR cycles are at least 5 years apart, so any plausible re-application
 * lives far outside this window — the threshold mostly absorbs typos.
 */
const SAME_APPLICATION_BUCKET_DAYS = 365;

/** Minimum input shape a row must have for the merge to consume it. */
export interface MergeableCase {
  /** Stable per-post identifier, kept for provenance. */
  id: string;
  /** Forum thread the post belongs to. Required for grouping. */
  threadId: string;
  /** Forum username, or null if we never read it. Null disables merging. */
  authorName: string | null;
  /** When the post itself was written on the forum. May be null on old rows. */
  postedAt: Date | null;
  /** Source URL for transparency. We collect ALL of these on the merged case. */
  sourceUrl: string;

  /** Snapshot fields the merge folds across contributing posts. */
  applicationRoute: string | null;
  applicationType?: string | null;
  serviceTier: string | null;
  applicationDate: Date | null;
  biometricsDate?: Date | null;
  docsRequestedDate?: Date | null;
  docsSubmittedDate?: Date | null;
  decisionDate: Date | null;
  biometricsLocation: string | null;
  decisionCenter?: string | null;
  applicantNationality?: string | null;
  applicantNationalityCode: string | null;
  outcome: string | null;
  isPending: boolean;
  confidence: number;
}

/** A merged case is the same shape as MergeableCase, plus provenance arrays. */
export interface MergedCase extends Omit<MergeableCase, 'id' | 'sourceUrl'> {
  /** Stable key for this merged case (see `caseKey`). Doubles as `id`. */
  id: string;
  /** All contributing post IDs, in chronological order. */
  contributingPostIds: string[];
  /** All contributing source URLs, in chronological order, deduped. */
  sourceUrls: string[];
  /** Number of contributing posts. */
  contributingPostCount: number;
}

/**
 * Compute the merge key for a row. Two rows with the same key are merged
 * into one case; rows with different keys are kept separate.
 *
 * Rules:
 *   - NULL author       → never merged (synthetic per-post key).
 *   - non-null author   → keyed by (thread, author, applicationDateBucket).
 *     The bucket is the floor of the application date in 365-day units, or
 *     "null" if the application date isn't known. That way:
 *       * two posts by the same user within 365 days collapse,
 *       * two posts whose applicationDate values disagree by years (e.g.
 *         the user came back later in the same thread for a different
 *         visa) stay separate,
 *       * posts where the application date isn't yet known still merge
 *         with each other (the "null" bucket) — they'll be reconciled when
 *         a later post fills the field in.
 */
export function caseKey(row: Pick<MergeableCase, 'id' | 'threadId' | 'authorName' | 'applicationDate'>): string {
  if (!row.authorName) return `post:${row.id}`;
  const bucket = row.applicationDate
    ? Math.floor(row.applicationDate.getTime() / (SAME_APPLICATION_BUCKET_DAYS * DAY_MS))
    : 'null';
  return `${row.threadId}|${row.authorName}|${bucket}`;
}

/**
 * Sort rows chronologically (oldest first) with a deterministic tiebreaker.
 * `postedAt` of null sorts to the end — those are old rows we backfilled
 * later and we'd rather trust the dated ones first.
 */
function chronologicalSort<T extends Pick<MergeableCase, 'postedAt' | 'id'>>(rows: T[]): T[] {
  return rows.slice().sort((a, b) => {
    const at = a.postedAt?.getTime() ?? Number.POSITIVE_INFINITY;
    const bt = b.postedAt?.getTime() ?? Number.POSITIVE_INFINITY;
    if (at !== bt) return at - bt;
    return a.id.localeCompare(b.id);
  });
}

/** Pick the EARLIEST non-null Date across a chronologically-sorted list. */
function earliestDate(rows: MergeableCase[], pick: (r: MergeableCase) => Date | null | undefined): Date | null {
  let best: Date | null = null;
  for (const r of rows) {
    const v = pick(r);
    if (v && (!best || v.getTime() < best.getTime())) best = v;
  }
  return best;
}

/** Pick the LATEST non-null Date across a chronologically-sorted list. */
function latestDate(rows: MergeableCase[], pick: (r: MergeableCase) => Date | null | undefined): Date | null {
  let best: Date | null = null;
  for (const r of rows) {
    const v = pick(r);
    if (v && (!best || v.getTime() > best.getTime())) best = v;
  }
  return best;
}

/** Pick the FIRST non-null value across a chronologically-sorted list. */
function firstNonNull<T>(rows: MergeableCase[], pick: (r: MergeableCase) => T | null | undefined): T | null {
  for (const r of rows) {
    const v = pick(r);
    if (v !== null && v !== undefined) return v;
  }
  return null;
}

/** Pick the LAST non-null value across a chronologically-sorted list. */
function lastNonNull<T>(rows: MergeableCase[], pick: (r: MergeableCase) => T | null | undefined): T | null {
  for (let i = rows.length - 1; i >= 0; i--) {
    const v = pick(rows[i]!);
    if (v !== null && v !== undefined) return v;
  }
  return null;
}

/**
 * Derive the outcome for a merged case.
 *
 * Once `approved` or `rejected` appears in any contributing post, that's
 * terminal — even if a later post says `pending` (people sometimes post
 * out of order or copy old text). `pending` beats `unknown`. `unknown`
 * stays only if every contributing row is unknown.
 *
 * This deliberately ignores the order of the rows: we want the strongest
 * signal we have, not "what did they say most recently".
 */
function deriveOutcome(rows: MergeableCase[]): 'approved' | 'rejected' | 'pending' | 'unknown' {
  let any: 'approved' | 'rejected' | null = null;
  let seenPending = false;
  for (const r of rows) {
    if (r.outcome === 'approved') {
      if (any !== 'rejected') any = 'approved';
    } else if (r.outcome === 'rejected') {
      // Rejection wins over approval ONLY if no approval has been seen first.
      // In practice every contributing post will agree; ties are rare.
      any = any ?? 'rejected';
    } else if (r.outcome === 'pending') {
      seenPending = true;
    }
  }
  if (any) return any;
  if (seenPending) return 'pending';
  return 'unknown';
}

/** Fold one group of contributing posts into a single MergedCase. */
function foldGroup(key: string, rows: MergeableCase[]): MergedCase {
  const sorted = chronologicalSort(rows);

  const applicationDate = earliestDate(sorted, (r) => r.applicationDate);
  const decisionDate = latestDate(sorted, (r) => r.decisionDate);
  const outcome = deriveOutcome(sorted);

  // isPending is a derived predicate; never copied. A case is pending iff
  // the merged outcome is pending OR we have an application date but no
  // decision date yet. This stays consistent with how `extractor.ts`
  // derives the field on a single post.
  const isPending =
    outcome === 'pending' || (!!applicationDate && !decisionDate);

  // Confidence: highest among contributors. A user with one strong post
  // and two weak ones is at least as well understood as the strongest
  // single post on its own.
  const confidence = sorted.reduce((m, r) => Math.max(m, r.confidence), 0);

  // Provenance: arrays preserve order of contribution.
  const contributingPostIds = sorted.map((r) => r.id);
  const seenUrls = new Set<string>();
  const sourceUrls: string[] = [];
  for (const r of sorted) {
    if (!seenUrls.has(r.sourceUrl)) {
      seenUrls.add(r.sourceUrl);
      sourceUrls.push(r.sourceUrl);
    }
  }

  return {
    id: key,
    threadId: sorted[0]!.threadId,
    authorName: sorted[0]!.authorName,
    // postedAt on the merged case is the earliest contributing post — that's
    // the moment this case became visible to the world.
    postedAt: sorted.find((r) => r.postedAt)?.postedAt ?? null,

    applicationRoute: lastNonNull(sorted, (r) => r.applicationRoute),
    applicationType: lastNonNull(sorted, (r) => r.applicationType),
    serviceTier: lastNonNull(sorted, (r) => r.serviceTier),

    applicationDate,
    biometricsDate: earliestDate(sorted, (r) => r.biometricsDate),
    docsRequestedDate: earliestDate(sorted, (r) => r.docsRequestedDate),
    docsSubmittedDate: earliestDate(sorted, (r) => r.docsSubmittedDate),
    decisionDate,

    biometricsLocation: lastNonNull(sorted, (r) => r.biometricsLocation),
    decisionCenter: lastNonNull(sorted, (r) => r.decisionCenter),

    applicantNationality: firstNonNull(sorted, (r) => r.applicantNationality),
    applicantNationalityCode: firstNonNull(sorted, (r) => r.applicantNationalityCode),

    outcome,
    isPending,
    confidence,

    contributingPostIds,
    sourceUrls,
    contributingPostCount: sorted.length,
  };
}

/**
 * Fold N per-post extractions into M merged cases (M <= N). Pure: no DB,
 * no side effects, no Date.now(). Stable: same input always produces the
 * same output, including the order of merged cases (matches the order in
 * which their first contributing post appeared in `rows`).
 */
export function mergeCases(rows: MergeableCase[]): MergedCase[] {
  const groups = new Map<string, MergeableCase[]>();
  const order: string[] = [];

  for (const row of rows) {
    const key = caseKey(row);
    let bucket = groups.get(key);
    if (!bucket) {
      bucket = [];
      groups.set(key, bucket);
      order.push(key);
    }
    bucket.push(row);
  }

  return order.map((k) => foldGroup(k, groups.get(k)!));
}
