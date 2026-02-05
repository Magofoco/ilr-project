import type { FastifyInstance } from 'fastify';
import { prisma } from '@ilr/db';

export async function healthRoutes(fastify: FastifyInstance) {
  // Basic health check
  fastify.get('/', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  // Deep health check (includes DB)
  fastify.get('/deep', async (request, reply) => {
    try {
      // Check database connection
      await prisma.$queryRaw`SELECT 1`;
      
      return {
        status: 'ok',
        timestamp: new Date().toISOString(),
        services: {
          database: 'ok',
        },
      };
    } catch (err) {
      fastify.log.error(err, 'Health check failed');
      return reply.status(503).send({
        status: 'error',
        timestamp: new Date().toISOString(),
        services: {
          database: 'error',
        },
      });
    }
  });
}
