import type { FastifyInstance } from 'fastify';
import { prisma, Prisma } from '@ilr/db';
import { casesQuerySchema, type CaseWithSource, type PaginatedResponse } from '@ilr/shared';

export async function casesRoutes(fastify: FastifyInstance) {
  // Auth is handled by the authenticated scope in index.ts.

  // List cases with filters
  fastify.get('/', async (request): Promise<PaginatedResponse<CaseWithSource>> => {
    const query = casesQuerySchema.parse(request.query);

    const where: Prisma.ExtractedCaseWhereInput = {};

    if (query.applicationRoute) where.applicationRoute = query.applicationRoute;
    if (query.applicationType) where.applicationType = query.applicationType;
    if (query.serviceTier) where.serviceTier = query.serviceTier;
    if (query.biometricsLocation) where.biometricsLocation = query.biometricsLocation;
    if (query.applicantNationalityCode) where.applicantNationalityCode = query.applicantNationalityCode;
    if (query.outcome) where.outcome = query.outcome;
    if (query.sourceId) where.post = { thread: { sourceId: query.sourceId } };

    if (query.fromDate || query.toDate) {
      where.applicationDate = {};
      if (query.fromDate) where.applicationDate.gte = query.fromDate;
      if (query.toDate) where.applicationDate.lte = query.toDate;
    }
    if (query.minConfidence !== undefined) {
      where.confidence = { gte: query.minConfidence };
    }

    const total = await prisma.extractedCase.count({ where });

    const cases = await prisma.extractedCase.findMany({
      where,
      include: {
        post: {
          select: {
            id: true,
            content: true,
            authorName: true,
            postedAt: true,
            thread: {
              select: {
                id: true,
                title: true,
                url: true,
                source: { select: { id: true, name: true, displayName: true } },
              },
            },
          },
        },
      },
      orderBy: { [query.sortBy]: query.sortOrder },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });

    return {
      data: cases as unknown as CaseWithSource[],
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  });

  // Get available filter options for the UI dropdowns.
  fastify.get('/filters', async () => {
    const [routes, types, locations, tiers, nationalities, sources] = await Promise.all([
      prisma.extractedCase.findMany({
        where: { applicationRoute: { not: null } },
        select: { applicationRoute: true },
        distinct: ['applicationRoute'],
      }),
      prisma.extractedCase.findMany({
        where: { applicationType: { not: null } },
        select: { applicationType: true },
        distinct: ['applicationType'],
      }),
      prisma.extractedCase.findMany({
        where: { biometricsLocation: { not: null } },
        select: { biometricsLocation: true },
        distinct: ['biometricsLocation'],
      }),
      prisma.extractedCase.findMany({
        where: { serviceTier: { not: null } },
        select: { serviceTier: true },
        distinct: ['serviceTier'],
      }),
      prisma.extractedCase.findMany({
        where: { applicantNationalityCode: { not: null } },
        select: { applicantNationalityCode: true },
        distinct: ['applicantNationalityCode'],
      }),
      prisma.sourceForum.findMany({
        where: { isActive: true },
        select: { id: true, name: true, displayName: true },
      }),
    ]);

    return {
      applicationRoutes: routes
        .map((r: { applicationRoute: string | null }) => r.applicationRoute)
        .filter((v): v is string => Boolean(v)),
      applicationTypes: types
        .map((t: { applicationType: string | null }) => t.applicationType)
        .filter((v): v is string => Boolean(v)),
      biometricsLocations: locations
        .map((l: { biometricsLocation: string | null }) => l.biometricsLocation)
        .filter((v): v is string => Boolean(v))
        .sort((a, b) => a.localeCompare(b)),
      serviceTiers: tiers
        .map((t: { serviceTier: string | null }) => t.serviceTier)
        .filter((v): v is string => Boolean(v)),
      nationalityCodes: nationalities
        .map((n: { applicantNationalityCode: string | null }) => n.applicantNationalityCode)
        .filter((v): v is string => Boolean(v))
        .sort(),
      sources,
    };
  });

  // Get single case by ID
  fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { id } = request.params;

    const caseData = await prisma.extractedCase.findUnique({
      where: { id },
      include: {
        post: {
          select: {
            id: true,
            content: true,
            authorName: true,
            postedAt: true,
            thread: {
              select: {
                id: true,
                title: true,
                url: true,
                source: { select: { id: true, name: true, displayName: true } },
              },
            },
          },
        },
        events: {
          orderBy: { eventDate: 'asc' },
        },
      },
    });

    if (!caseData) {
      return reply.status(404).send({
        error: 'Not Found',
        message: 'Case not found',
        statusCode: 404,
      });
    }

    return caseData;
  });
}
