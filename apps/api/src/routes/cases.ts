import type { FastifyInstance } from 'fastify';
import { prisma, Prisma } from '@ilr/db';
import { casesQuerySchema, type CaseWithSource, type PaginatedResponse } from '@ilr/shared';

export async function casesRoutes(fastify: FastifyInstance) {
  // Auth is handled by the authenticated scope in index.ts.
  // All routes here automatically require a valid JWT.

  // List cases with filters
  fastify.get('/', async (request): Promise<PaginatedResponse<CaseWithSource>> => {
    const query = casesQuerySchema.parse(request.query);

    const where: Prisma.ExtractedCaseWhereInput = {};

    // Apply filters
    if (query.applicationRoute) {
      where.applicationRoute = query.applicationRoute;
    }
    if (query.applicationType) {
      where.applicationType = query.applicationType;
    }
    if (query.serviceCenter) {
      where.serviceCenter = query.serviceCenter;
    }
    if (query.outcome) {
      where.outcome = query.outcome;
    }
    if (query.sourceId) {
      where.post = { thread: { sourceId: query.sourceId } };
    }
    if (query.fromDate || query.toDate) {
      where.applicationDate = {};
      if (query.fromDate) where.applicationDate.gte = query.fromDate;
      if (query.toDate) where.applicationDate.lte = query.toDate;
    }
    if (query.minConfidence !== undefined) {
      where.confidence = { gte: query.minConfidence };
    }

    // Count total
    const total = await prisma.extractedCase.count({ where });

    // Fetch paginated results
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
                source: {
                  select: {
                    id: true,
                    name: true,
                    displayName: true,
                  },
                },
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
      data: cases as CaseWithSource[],
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
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
                source: {
                  select: {
                    id: true,
                    name: true,
                    displayName: true,
                  },
                },
              },
            },
          },
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

  // Get available filter options
  fastify.get('/filters', async () => {
    const [routes, types, centers, sources] = await Promise.all([
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
        where: { serviceCenter: { not: null } },
        select: { serviceCenter: true },
        distinct: ['serviceCenter'],
      }),
      prisma.sourceForum.findMany({
        where: { isActive: true },
        select: { id: true, name: true, displayName: true },
      }),
    ]);

    return {
      applicationRoutes: routes.map((r: { applicationRoute: string | null }) => r.applicationRoute).filter(Boolean),
      applicationTypes: types.map((t: { applicationType: string | null }) => t.applicationType).filter(Boolean),
      serviceCenters: centers.map((c: { serviceCenter: string | null }) => c.serviceCenter).filter(Boolean),
      sources,
    };
  });
}
