/**
 * Cohort selection + survival analysis for the estimator.
 *
 * Both `/stats/overview` and `POST /estimate` route through these helpers so
 * they share one statistical lens — pending cases are right-censored, never
 * silently dropped.
 */

import { prisma, Prisma } from '@ilr/db';
import {
  kaplanMeier,
  kmDecidedByDayFraction,
  mergeCases,
  type KmInput,
  type KmResult,
  type MergeableCase,
} from '@ilr/shared';
import type { ServiceTier } from '@ilr/shared';

const DAY_MS = 1000 * 60 * 60 * 24;

export interface CohortFilters {
  applicantNationalityCode?: string | null;
  applicationRoute?: string | null;
  biometricsLocation?: string | null;
  serviceTier?: ServiceTier | null;
  /** Only include cases whose applicationDate is within the last `windowDays`. */
  windowDays?: number;
  /** Minimum extraction confidence to include a case. Defaults to 0.5. */
  minConfidence?: number;
}

/**
 * A row in the cohort the estimator runs over. Post-merge, this corresponds
 * to ONE applicant (one merged case), not one raw forum post — see
 * `docs/case-merge-design.md` and `@ilr/shared`'s `mergeCases`.
 */
export interface CohortRecord {
  /** Stable case key produced by `caseKey()`. Doubles as the comparable-case id. */
  id: string;
  applicationDate: Date;
  decisionDate: Date | null;
  outcome: string | null;
  isPending: boolean;
  applicationRoute: string | null;
  serviceTier: ServiceTier | null;
  biometricsLocation: string | null;
  applicantNationalityCode: string | null;
  confidence: number;
  /**
   * ALL forum URLs that contributed to this merged case, in chronological
   * order. Most cases have exactly one entry; the multi-entry case is "the
   * same user updated their timeline across N replies".
   */
  sourceUrls: string[];
  /** Number of contributing posts. Useful for transparency in the UI. */
  contributingPostCount: number;
}

/**
 * Build a Prisma `where` for ExtractedCase from filter inputs. Filters with
 * `null` are equivalent to "no constraint" — they're explicitly distinguished
 * from `undefined` so the cohort relaxation step can express "I removed this
 * filter" cleanly.
 */
export function buildCohortWhere(filters: CohortFilters, now: Date): Prisma.ExtractedCaseWhereInput {
  const where: Prisma.ExtractedCaseWhereInput = {
    // Survival analysis is only meaningful when we know when waiting started.
    applicationDate: { not: null },
    confidence: { gte: filters.minConfidence ?? 0.5 },
  };

  if (filters.applicantNationalityCode) {
    where.applicantNationalityCode = filters.applicantNationalityCode;
  }
  if (filters.applicationRoute) {
    where.applicationRoute = filters.applicationRoute;
  }
  if (filters.biometricsLocation) {
    where.biometricsLocation = filters.biometricsLocation;
  }
  if (filters.serviceTier) {
    where.serviceTier = filters.serviceTier;
  }

  if (filters.windowDays && filters.windowDays > 0) {
    const cutoff = new Date(now.getTime() - filters.windowDays * DAY_MS);
    // Combine with the existing applicationDate `not: null` constraint.
    where.applicationDate = { not: null, gte: cutoff };
  }

  return where;
}

/**
 * Load the cohort, then collapse multi-post-per-applicant rows into one
 * merged case per applicant (see `docs/case-merge-design.md`).
 *
 * The merge happens here, before relaxation and KM, so every downstream
 * helper (`buildKmInputs`, `computeApprovalRate`, the comparable-cases
 * endpoint) automatically sees one row = one applicant.
 *
 * IMPORTANT: filter relaxation re-calls `loadCohort` with progressively
 * looser filters. Each call re-merges. That's correct: a user whose
 * posts all carry the same `biometricsLocation` collapses cleanly whether
 * we filter on it or not.
 */
export async function loadCohort(filters: CohortFilters, now: Date = new Date()): Promise<CohortRecord[]> {
  const where = buildCohortWhere(filters, now);

  const rows = await prisma.extractedCase.findMany({
    where,
    select: {
      id: true,
      applicationDate: true,
      biometricsDate: true,
      docsRequestedDate: true,
      docsSubmittedDate: true,
      decisionDate: true,
      outcome: true,
      isPending: true,
      applicationRoute: true,
      applicationType: true,
      serviceTier: true,
      biometricsLocation: true,
      decisionCenter: true,
      applicantNationality: true,
      applicantNationalityCode: true,
      confidence: true,
      post: {
        select: {
          threadId: true,
          authorName: true,
          postedAt: true,
          thread: {
            select: { url: true },
          },
        },
      },
    },
  });

  // Map to the MergeableCase shape and drop rows that have no
  // applicationDate (the survival lens requires a wait-start date).
  const mergeable: MergeableCase[] = rows
    .filter((r): r is typeof r & { applicationDate: Date } => r.applicationDate !== null)
    .map((r) => ({
      id: r.id,
      threadId: r.post.threadId,
      authorName: r.post.authorName,
      postedAt: r.post.postedAt,
      sourceUrl: r.post.thread.url,
      applicationRoute: r.applicationRoute,
      applicationType: r.applicationType,
      serviceTier: r.serviceTier,
      applicationDate: r.applicationDate,
      biometricsDate: r.biometricsDate,
      docsRequestedDate: r.docsRequestedDate,
      docsSubmittedDate: r.docsSubmittedDate,
      decisionDate: r.decisionDate,
      biometricsLocation: r.biometricsLocation,
      decisionCenter: r.decisionCenter,
      applicantNationality: r.applicantNationality,
      applicantNationalityCode: r.applicantNationalityCode,
      outcome: r.outcome,
      isPending: r.isPending,
      confidence: r.confidence,
    }));

  const merged = mergeCases(mergeable);

  // Project the merged cases to CohortRecord shape. We drop cases that lost
  // their applicationDate during the merge (shouldn't happen since every
  // input has one, but the type narrowing makes the downstream usage clean).
  return merged
    .filter((m): m is typeof m & { applicationDate: Date } => m.applicationDate !== null)
    .map((m) => ({
      id: m.id,
      applicationDate: m.applicationDate,
      decisionDate: m.decisionDate,
      outcome: m.outcome,
      isPending: m.isPending,
      applicationRoute: m.applicationRoute,
      serviceTier: (m.serviceTier as ServiceTier | null) ?? null,
      biometricsLocation: m.biometricsLocation,
      applicantNationalityCode: m.applicantNationalityCode,
      confidence: m.confidence,
      sourceUrls: m.sourceUrls,
      contributingPostCount: m.contributingPostCount,
    }));
}

/**
 * Convert cohort records into Kaplan–Meier inputs.
 *
 * Decision rules:
 *   - decisionDate present → event=true, duration = decisionDate - applicationDate
 *   - decisionDate absent → event=false (right-censored), duration = now - applicationDate
 *   - duration <= 0 → skipped (data error)
 *
 * Note: outcome of "rejected" still counts as an event (the wait ended). The
 * approval rate is computed separately from the outcome field.
 */
export function buildKmInputs(records: CohortRecord[], now: Date = new Date()): KmInput[] {
  const inputs: KmInput[] = [];

  for (const r of records) {
    if (r.decisionDate) {
      const duration = (r.decisionDate.getTime() - r.applicationDate.getTime()) / DAY_MS;
      if (duration > 0 && duration < 1500) {
        inputs.push({ durationDays: duration, eventObserved: true });
      }
    } else {
      const duration = (now.getTime() - r.applicationDate.getTime()) / DAY_MS;
      if (duration > 0 && duration < 1500) {
        inputs.push({ durationDays: duration, eventObserved: false });
      }
    }
  }

  return inputs;
}

/**
 * Compute approval rate among _decided_ cases in the cohort.
 * Returns null if too few decided cases (< 10) to be meaningful.
 *
 * Bias note: this is a forum-self-reported approval rate. Refused applicants
 * are systematically under-reported — show this number with a caveat in UI.
 */
export function computeApprovalRate(records: CohortRecord[], minDecided = 10): number | null {
  let approved = 0;
  let rejected = 0;
  for (const r of records) {
    if (r.outcome === 'approved') approved++;
    else if (r.outcome === 'rejected') rejected++;
  }
  const decided = approved + rejected;
  if (decided < minDecided) return null;
  return approved / decided;
}

/**
 * Subsample the KM curve to at most `maxPoints` points for transport.
 * Always preserves the first and last points; otherwise samples evenly.
 */
export function subsampleKm(km: KmResult, maxPoints = 200): KmResult {
  if (km.points.length <= maxPoints) return km;

  const step = (km.points.length - 1) / (maxPoints - 1);
  const sampled: typeof km.points = [];
  for (let i = 0; i < maxPoints; i++) {
    const idx = Math.round(i * step);
    sampled.push(km.points[idx]!);
  }
  return { ...km, points: sampled };
}

export { kaplanMeier, kmDecidedByDayFraction };
