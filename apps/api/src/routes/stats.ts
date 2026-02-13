import type { FastifyInstance } from 'fastify';
import { prisma, Prisma } from '@ilr/db';
import type { OverviewStats } from '@ilr/shared';

export async function statsRoutes(fastify: FastifyInstance) {
  // Auth is handled by the authenticated scope in index.ts.
  // All routes here automatically require a valid JWT.

  // Overview stats
  fastify.get('/overview', async (): Promise<OverviewStats> => {
    // Get total cases with valid waiting days
    const totalCases = await prisma.extractedCase.count({
      where: { waitingDays: { not: null } },
    });

    // Cases from last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const casesLast30Days = await prisma.extractedCase.count({
      where: {
        waitingDays: { not: null },
        createdAt: { gte: thirtyDaysAgo },
      },
    });

    // Get all waiting days for median calculation
    const allWaitingDays = await prisma.extractedCase.findMany({
      where: { waitingDays: { not: null } },
      select: { waitingDays: true },
      orderBy: { waitingDays: 'asc' },
    });

    const waitingDaysValues = allWaitingDays
      .map((c: { waitingDays: number | null }) => c.waitingDays)
      .filter((d: number | null): d is number => d !== null);

    const medianWaitingDays = calculateMedian(waitingDaysValues);
    const averageWaitingDays = waitingDaysValues.length > 0
      ? Math.round(waitingDaysValues.reduce((a: number, b: number) => a + b, 0) / waitingDaysValues.length)
      : null;

    // Approval rate
    const outcomeStats = await prisma.extractedCase.groupBy({
      by: ['outcome'],
      _count: { outcome: true },
      where: { outcome: { in: ['approved', 'rejected'] } },
    });

    const approved = outcomeStats.find((s: { outcome: string | null }) => s.outcome === 'approved')?._count.outcome || 0;
    const rejected = outcomeStats.find((s: { outcome: string | null }) => s.outcome === 'rejected')?._count.outcome || 0;
    const approvalRate = approved + rejected > 0 
      ? Math.round((approved / (approved + rejected)) * 100) 
      : null;

    // Stats by route
    const byRouteRaw = await prisma.extractedCase.groupBy({
      by: ['applicationRoute'],
      _count: { applicationRoute: true },
      where: { 
        applicationRoute: { not: null },
        waitingDays: { not: null },
      },
    });

    const byRoute = await Promise.all(
      byRouteRaw.map(async (r: { applicationRoute: string | null; _count: { applicationRoute: number } }) => {
        const routeCases = await prisma.extractedCase.findMany({
          where: { 
            applicationRoute: r.applicationRoute,
            waitingDays: { not: null },
          },
          select: { waitingDays: true },
          orderBy: { waitingDays: 'asc' },
        });
        const days = routeCases
          .map((c: { waitingDays: number | null }) => c.waitingDays)
          .filter((d: number | null): d is number => d !== null);
        return {
          route: r.applicationRoute || 'Unknown',
          count: r._count.applicationRoute,
          medianDays: calculateMedian(days),
        };
      })
    );

    // Stats by month (last 12 months)
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

    const byMonthCases = await prisma.extractedCase.findMany({
      where: {
        decisionDate: { gte: twelveMonthsAgo },
        waitingDays: { not: null },
      },
      select: { decisionDate: true, waitingDays: true },
    });

    const monthMap = new Map<string, number[]>();
    for (const c of byMonthCases) {
      if (c.decisionDate && c.waitingDays !== null) {
        const key = c.decisionDate.toISOString().slice(0, 7); // YYYY-MM
        const arr = monthMap.get(key) || [];
        arr.push(c.waitingDays);
        monthMap.set(key, arr);
      }
    }

    const byMonth = Array.from(monthMap.entries())
      .map(([month, days]) => ({
        month,
        count: days.length,
        medianDays: calculateMedian(days),
      }))
      .sort((a, b) => a.month.localeCompare(b.month));

    return {
      totalCases,
      casesLast30Days,
      medianWaitingDays,
      averageWaitingDays,
      approvalRate,
      byRoute,
      byMonth,
    };
  });
}

function calculateMedian(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]!
    : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}
