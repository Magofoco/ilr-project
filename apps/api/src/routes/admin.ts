import type { FastifyInstance } from 'fastify';
import { prisma, Prisma } from '@ilr/db';
import { createSourceForumSchema, updateSourceForumSchema, triggerScrapeSchema } from '@ilr/shared';

export async function adminRoutes(fastify: FastifyInstance) {
  // Auth (JWT + admin role) is handled by the admin scope in index.ts.
  // All routes here automatically require a valid JWT + admin role.

  // List all sources
  fastify.get('/sources', async () => {
    const sources = await prisma.sourceForum.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { threads: true, scrapeRuns: true },
        },
      },
    });
    return sources;
  });

  // Get single source
  fastify.get<{ Params: { id: string } }>('/sources/:id', async (request, reply) => {
    const { id } = request.params;
    
    const source = await prisma.sourceForum.findUnique({
      where: { id },
      include: {
        _count: {
          select: { threads: true, scrapeRuns: true },
        },
        scrapeRuns: {
          orderBy: { startedAt: 'desc' },
          take: 10,
        },
      },
    });

    if (!source) {
      return reply.status(404).send({
        error: 'Not Found',
        message: 'Source not found',
        statusCode: 404,
      });
    }

    return source;
  });

  // Create source
  fastify.post('/sources', async (request, reply) => {
    const data = createSourceForumSchema.parse(request.body);
    
    const source = await prisma.sourceForum.create({
      data: {
        ...data,
        config: data.config as Prisma.InputJsonValue,
      },
    });

    return reply.status(201).send(source);
  });

  // Update source
  fastify.patch<{ Params: { id: string } }>('/sources/:id', async (request, reply) => {
    const { id } = request.params;
    const data = updateSourceForumSchema.parse(request.body);

    try {
      const source = await prisma.sourceForum.update({
        where: { id },
        data: {
          ...data,
          config: data.config ? (data.config as Prisma.InputJsonValue) : undefined,
        },
      });
      return source;
    } catch {
      return reply.status(404).send({
        error: 'Not Found',
        message: 'Source not found',
        statusCode: 404,
      });
    }
  });

  // Delete source
  fastify.delete<{ Params: { id: string } }>('/sources/:id', async (request, reply) => {
    const { id } = request.params;

    try {
      await prisma.sourceForum.delete({
        where: { id },
      });
      return reply.status(204).send();
    } catch {
      return reply.status(404).send({
        error: 'Not Found',
        message: 'Source not found',
        statusCode: 404,
      });
    }
  });

  // Trigger a scrape run
  fastify.post('/scrape/trigger', async (request, reply) => {
    const { sourceId, since, maxThreads } = triggerScrapeSchema.parse(request.body);

    // Verify source exists
    const source = await prisma.sourceForum.findUnique({
      where: { id: sourceId },
    });

    if (!source) {
      return reply.status(404).send({
        error: 'Not Found',
        message: 'Source not found',
        statusCode: 404,
      });
    }

    // Create a scrape run record
    const scrapeRun = await prisma.scrapeRun.create({
      data: {
        sourceId,
        status: 'running',
        runConfig: {
          since: since?.toISOString(),
          maxThreads,
          triggeredBy: request.user?.id,
        },
      },
    });

    // In a real implementation, this would trigger the worker
    // For now, we just return the created run
    // The worker would be triggered via:
    // 1. A message queue (Redis, SQS, etc.)
    // 2. A direct HTTP call to the worker service
    // 3. A GitHub Actions dispatch event

    fastify.log.info({ scrapeRunId: scrapeRun.id, sourceId }, 'Scrape run triggered');

    return reply.status(202).send({
      message: 'Scrape run started',
      scrapeRunId: scrapeRun.id,
    });
  });

  // List scrape runs
  fastify.get('/scrape/runs', async (request) => {
    const runs = await prisma.scrapeRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: 50,
      include: {
        source: {
          select: { id: true, name: true, displayName: true },
        },
      },
    });
    return runs;
  });

  // Get scrape run details
  fastify.get<{ Params: { id: string } }>('/scrape/runs/:id', async (request, reply) => {
    const { id } = request.params;

    const run = await prisma.scrapeRun.findUnique({
      where: { id },
      include: {
        source: {
          select: { id: true, name: true, displayName: true },
        },
      },
    });

    if (!run) {
      return reply.status(404).send({
        error: 'Not Found',
        message: 'Scrape run not found',
        statusCode: 404,
      });
    }

    return run;
  });
}
