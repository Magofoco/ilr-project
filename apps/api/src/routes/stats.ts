import type { FastifyInstance } from 'fastify';
import { prisma } from '@ilr/db';
import { kaplanMeier, kmPercentile } from '@ilr/shared';
import type { OverviewStats } from '@ilr/shared';
import { buildKmInputs, computeApprovalRate, loadCohort } from '../lib/cohort.js';

const DAY_MS = 1000 * 60 * 60 * 24;

export async function statsRoutes(fastify: FastifyInstance) {
  // Auth is handled by the authenticated scope in index.ts.

  fastify.get('/overview', async (): Promise<OverviewStats> => {
    const now = new Date();

    // ============ TOTAL & WINDOW COUNTS ============
    // We count cases with an application date, regardless of pending state —
    // pending cases are part of "total cases", they're just censored in the
    // statistics below.
    const totalCases = await prisma.extractedCase.count({
      where: { applicationDate: { not: null } },
    });

    const thirtyDaysAgo = new Date(now.getTime() - 30 * DAY_MS);
    const casesLast30Days = await prisma.extractedCase.count({
      where: {
        applicationDate: { not: null },
        createdAt: { gte: thirtyDaysAgo },
      },
    });

    // ============ KM-BASED MEDIAN OVER LAST 24 MONTHS ============
    // Use the same cohort helper as /estimate so both endpoints share one
    // statistical lens. windowDays=730 = last 2 years, matching the default
    // estimator window.
    const cohort = await loadCohort({ windowDays: 730 }, now);
    const kmInputs = buildKmInputs(cohort, now);
    const km = kaplanMeier(kmInputs);

    const medianWaitingDays = kmPercentile(km, 0.5);

    // The mean is reported only over decided cases for transparency — it is
    // intentionally biased high or low depending on which cases finished first.
    const decided = cohort.filter((c) => c.decisionDate);
    const decidedDurations = decided.map(
      (c) => (c.decisionDate!.getTime() - c.applicationDate.getTime()) / DAY_MS
    );
    const averageWaitingDaysDecided = decidedDurations.length
      ? Math.round(decidedDurations.reduce((a, b) => a + b, 0) / decidedDurations.length)
      : null;

    // Approval rate from the same cohort. Returned as a 0–100 percentage to
    // preserve the previous public contract.
    const approvalFraction = computeApprovalRate(cohort);
    const approvalRate = approvalFraction !== null ? Math.round(approvalFraction * 100) : null;

    const decidedCount = km.decidedCount;
    const pendingCount = km.censoredCount;

    // ============ BY ROUTE ============
    const byRouteRaw = await prisma.extractedCase.groupBy({
      by: ['applicationRoute'],
      _count: { applicationRoute: true },
      where: {
        applicationRoute: { not: null },
        applicationDate: { not: null },
      },
    });

    const byRoute = await Promise.all(
      byRouteRaw.map(async (r: { applicationRoute: string | null; _count: { applicationRoute: number } }) => {
        const subCohort = await loadCohort(
          { applicationRoute: r.applicationRoute, windowDays: 730 },
          now
        );
        const subKm = kaplanMeier(buildKmInputs(subCohort, now));
        return {
          route: r.applicationRoute || 'Unknown',
          count: r._count.applicationRoute,
          medianDays: kmPercentile(subKm, 0.5),
        };
      })
    );

    // ============ BY MONTH (last 12 months of decisions) ============
    // Note: this view is necessarily over decided cases only — "month of
    // decision" requires a decision. The headline median above is the
    // pending-aware number.
    const twelveMonthsAgo = new Date(now.getTime() - 365 * DAY_MS);
    const byMonthCases = await prisma.extractedCase.findMany({
      where: {
        decisionDate: { gte: twelveMonthsAgo },
        applicationDate: { not: null },
      },
      select: { decisionDate: true, applicationDate: true },
    });

    const monthMap = new Map<string, number[]>();
    for (const c of byMonthCases) {
      if (c.decisionDate && c.applicationDate) {
        const key = c.decisionDate.toISOString().slice(0, 7); // YYYY-MM
        const days = Math.round((c.decisionDate.getTime() - c.applicationDate.getTime()) / DAY_MS);
        if (days <= 0 || days > 1500) continue;
        const arr = monthMap.get(key) || [];
        arr.push(days);
        monthMap.set(key, arr);
      }
    }

    const byMonth = Array.from(monthMap.entries())
      .map(([month, days]) => ({
        month,
        count: days.length,
        medianDays: simpleMedian(days),
      }))
      .sort((a, b) => a.month.localeCompare(b.month));

    return {
      totalCases,
      casesLast30Days,
      medianWaitingDays,
      averageWaitingDaysDecided,
      approvalRate,
      decidedCount,
      pendingCount,
      byRoute,
      byMonth,
    };
  });
}

/**
 * Simple median over a numeric array. Used for the by-month view, which is
 * over decided-only cases (no censoring), so a non-KM median is appropriate.
 */
function simpleMedian(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]!
    : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}
