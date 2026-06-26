# Per-author case merge — design

**Status:** draft, awaiting sign-off
**Author:** Cursor, 2026-06-26
**Owner:** Francesco

## Problem

One forum user filing one ILR application typically posts multiple times in the
same thread — once when applying, again when biometrics are done, again when
the decision arrives. Each post matches the extractor's regexes, so each post
becomes a separate `ExtractedCase` row.

This breaks the cohort in two ways:

1. **Statistical double-counting.** A single applicant inflates the cohort by
   3–5×. The KM curve, the approval rate, the comparable-cases list, the
   percentiles — all of them are computed on rows where one applicant
   contributes multiple times.
2. **Decision-date leakage.** The decision date often appears only in the
   *last* post (the "I got my BRP!" update). The earlier posts of the same
   user are stored with `decisionDate = NULL` and `outcome = pending`. KM
   sees these as right-censored, even though we have the decision date one
   row away.

Concrete example from the live DB (user `deedee44`, thread `t231555`):

| post | applied | biometrics | decision | outcome |
|---|---|---|---|---|
| p1649449 (page 7) | 2018-03-13 | 2018-03-25 | – | unknown / pending |
| p1651400 (page 7) | 2018-03-13 | 2018-03-25 | – | unknown / pending |
| p1663173 (page 8) | 2018-03-13 | 2018-03-25 | – | unknown / pending |
| p1673651 (page 9) | 2018-03-13 | 2018-03-25 | – | unknown / pending |
| p1676081 (page 10) | 2018-03-13 | 2018-03-25 | **2018-08-31** | **approved** |

Five rows, one application. The first four should be censored *contributions*
of the same case, not separate censored cases.

Effective cohort impact today (after the duplicate-post cleanup):

- 225 `extracted_cases` rows
- 183 distinct `(thread, author_name)` pairs (author known)
- 17 posts with `author_name IS NULL` — never merged, each its own case
- ≈ 200 merged cases (≈ 22% inflation, before applying the 365d application-
  year bucket which may split a couple more)

The single worst offender is user `deedee44` (5 contributing posts → 1 case);
everyone else has ≤ 4 posts. Pre-dedup the inflation was much worse (≈45%)
because the `post_content_*` duplicates contributed twice each.

## Goals

1. Each unique `(thread, applicant)` shows up as **one case** in the cohort
   and the comparable-cases list.
2. Each case carries the **best-known snapshot** across all its contributing
   posts (latest non-null decision_date, earliest applicationDate, etc.).
3. **Provenance is preserved.** When the user clicks a comparable case, we
   can still show all the source posts (with their forum URLs) that
   contributed to it.
4. Re-extracting a single post must update the merged snapshot
   deterministically.
5. The censoring stays correct: if any contributing post has a decision date,
   the merged case is decided; otherwise it's censored.

## Identity key — what counts as "the same case"?

**Primary candidate:** `(thread_id, author_name)`.

**Edge cases:**
- `author_name IS NULL` (older posts scraped before we read the author
  byline). About 0 such rows now after re-extract, but possible historically.
  Decision: NULL-author posts each get their own synthetic identity
  (`post_id`), i.e. they are never merged. We don't have enough signal.
- Same author posts in two *different* threads. Different threads → different
  cases. The thread is part of the key.
- Same author files a second application years later **in the same thread**.
  Defence: if two posts of the same author have `applicationDate` values
  more than **365 days** apart, treat them as separate cases. (Rationale:
  ILR cycles are at least 5 years apart; same-thread re-applications are
  vanishingly rare. The 365d threshold is wide enough to absorb typos.)

**Pseudocode:**

```ts
function caseKey(post: PostWithExtraction): string {
  if (!post.authorName) return `post:${post.id}`;
  // Bucket by year of application date when present, otherwise just by
  // thread+author. A bucket of `null` is allowed and means "this user's
  // posts that don't carry an application date yet".
  const appYearBucket = post.applicationDate
    ? Math.floor(post.applicationDate.getTime() / (365 * 24 * 3600 * 1000))
    : 'null';
  return `${post.threadId}|${post.authorName}|${appYearBucket}`;
}
```

The bucket prevents the "second application 5 years later" merge bug. If
someone applies for ILR and later renews FLR in the same thread (unusual),
they'll be separate cases.

## Merge rules — which value wins per field?

We order contributing posts chronologically (by `postedAt` ascending, with
`post.id` as a deterministic tiebreaker).

| field | rule | rationale |
|---|---|---|
| `applicationRoute` | **most-recent non-null** | users sometimes correct themselves ("oh wait, this is 10-year not SET(O)") |
| `applicationType` | most-recent non-null | as above |
| `serviceTier` | most-recent non-null | same |
| `applicationDate` | **earliest non-null** | stable fact; first mention is usually most accurate, later edits are typos |
| `biometricsDate` | earliest non-null | same |
| `docsRequestedDate` | earliest non-null | first time it's mentioned |
| `docsSubmittedDate` | earliest non-null | same |
| `decisionDate` | **most-recent non-null** | decision arrives late in the thread |
| `biometricsLocation` | most-recent non-null | refinements over time |
| `decisionCenter` | most-recent non-null | |
| `applicantNationality` / `Code` | **first non-null** | comes from the forum profile flag, which is stable |
| `outcome` | derived (see below) | |
| `isPending` | derived (= `outcome === 'pending'` or `applicationDate && !decisionDate`) | |
| `waitingDays` | derived (`decisionDate - applicationDate`, only if both set) | recomputed, never copied |
| `confidence` | `max` across contributing posts | best evidence wins |
| `extractorVersion` | most-recent (should all match anyway) | |

### Outcome derivation

Walk the contributing posts in chronological order. Track the strongest
signal seen:

1. `approved` or `rejected` is **terminal** — once seen, that's the outcome.
   Ignore later `pending` signals on the same user (they posted out of
   order, or it's a follow-up question).
2. `pending` beats `unknown`.
3. `unknown` only stays if every post is `unknown`.

This is independent of `decisionDate`: if any post had a decision date,
the latest such date is the merged `decisionDate` — but the outcome
follows the rule above. (In practice these always agree.)

### Events

Union of all `CaseEvent` rows across the contributing posts, deduped by
`(type, eventDate)`. Already idempotent.

## Implementation options

### Option A — schema-level merge (recommended long-term)

Introduce a new top-level table `Case` that owns the merged snapshot, and
demote `ExtractedCase` to "per-post extraction".

```prisma
model Case {
  id              String   @id @default(cuid())
  threadId        String
  authorName      String?
  appYearBucket   String?  // null | "yyyy" — see caseKey above
  // ...all the merged snapshot fields...
  contributions   ExtractedCase[]
  events          CaseEvent[]
  @@unique([threadId, authorName, appYearBucket])
}

model ExtractedCase {
  // …existing fields…
  caseId String? @map("case_id")
  case   Case?   @relation(fields: [caseId], references: [id], onDelete: SetNull)
}

model CaseEvent {
  // moves from extracted_cases → cases (caseId is now Case.id, not ExtractedCase.id)
}
```

**Pros**
- Single source of truth for the cohort.
- Schema enforces the merge (unique constraint on the identity key).
- The estimator and admin UI just `SELECT * FROM cases`.
- Provenance is preserved via the `contributions` relation.

**Cons**
- Bigger migration. We have to backfill `caseId` for existing
  `ExtractedCase` rows in one pass, then rebuild `CaseEvent` to point at
  `Case` instead.
- Code in `apps/api/src/lib/cohort.ts`, the comparable-cases endpoint,
  and the admin UI all need to switch from `ExtractedCase` to `Case`.
- Re-extracting a single post requires recomputing the merged row for
  its case — non-trivial: changes can both add and remove fields.

**Effort:** 1–2 days of focused work plus careful testing. The
extractor itself is unchanged.

### Option B — flag a "primary" row, leave schema otherwise alone

Add `caseId` and `isPrimary` columns to `ExtractedCase`. The primary row
carries the merged snapshot; the rest stay as raw per-post extractions
for provenance.

**Pros:** smaller schema delta than A.

**Cons:** weird two-meaning table — every consumer has to remember
`WHERE is_primary = true` or face double-counting again. We'd just be
moving the bug from the data to the query layer.

**Not recommended.**

### Option C — application-layer merge (recommended first step)

No schema change. Add a helper in `apps/api/src/lib/cohort.ts` (or a new
`merge.ts`) that takes the raw `ExtractedCase[]` returned from the DB and
folds it into a `MergedCase[]` using the rules above. The estimator and
the comparable-cases endpoint both call this helper.

```ts
// apps/api/src/lib/case-merge.ts
export interface MergedCase {
  caseKey: string;
  threadId: string;
  authorName: string | null;
  // …all snapshot fields…
  contributingPostIds: string[];   // for provenance, source-URL list
  contributingPostUrls: string[];
}

export function mergeCases(rows: ExtractedCaseWithPost[]): MergedCase[] {
  const groups = new Map<string, ExtractedCaseWithPost[]>();
  for (const row of rows) {
    const key = caseKey(row);
    const bucket = groups.get(key) ?? [];
    bucket.push(row);
    groups.set(key, bucket);
  }
  return [...groups.values()].map(foldGroup);
}
```

**Pros**
- Reversible. Zero risk to the DB.
- Lets us validate the merge rules against real data before promoting to
  Option A.
- The KM estimator gets the correct cohort immediately.

**Cons**
- Disciplined consumers only — any future analytical query that hits
  `extracted_cases` directly bypasses the merge.
- The "extracted_cases.count" admin metric becomes misleading
  (it still counts contributions, not cases). We'd add a sibling
  "merged cases" count.

**Effort:** half a day. Just `merge.ts` + plumb into `estimate.ts` and the
comparable-cases endpoint.

## Recommendation

**Implement Option C first, then promote to Option A once we've validated
the merge rules against the live cohort for a week.**

Phase 1 — Option C, this week:
1. Add `packages/shared/src/utils/case-merge.ts` with `mergeCases()` and
   `caseKey()` (pure functions, unit-tested).
2. Plumb it into `apps/api/src/routes/estimate.ts` so the KM estimator runs
   on merged cases, not raw rows.
3. Plumb it into the comparable-cases endpoint so each card shows merged
   info and links to ALL contributing source posts.
4. Update the admin UI to show both "raw extractions" and "unique cases"
   counts so the discrepancy is visible.
5. Add a unit test using `deedee44`'s actual posts as the input.

Phase 2 — Option A, later:
6. Migrate the schema, backfill `caseId`, move `CaseEvent` to `Case`.
7. Drop `merge.ts` from the request path — query `Case` directly.

## Open questions for Francesco

1. **365-day bucket for second applications.** Acceptable, or should we
   tighten/loosen it?
2. **`outcome` derivation** — if the user's first post says "Refused" and a
   later post says "appealed and won", do we report `rejected` (per the
   "approved/rejected is terminal" rule) or `approved`? I lean `rejected`
   because the cohort definition is "first decision on the original
   application", but it's a judgement call.
3. **NULL author rows.** Today there are 17. They come from older scrapes
   that ran before the adapter learned to read the `.postprofile .username`
   element. The pseudocode above gives each NULL-author post its own
   synthetic case key (`post:<id>`). Alternative: backfill author names by
   re-running the scraper on those specific posts before turning on
   merging. My recommendation: just treat them as singletons; we lose 0%
   data and can backfill later.
4. Sign off on **Phase 1 = Option C**, then I'll implement it.
