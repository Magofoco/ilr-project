import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { prisma } from '@ilr/db';
import { authPlugin } from './plugins/auth.js';
import { healthRoutes } from './routes/health.js';
import { statsRoutes } from './routes/stats.js';
import { casesRoutes } from './routes/cases.js';
import { adminRoutes } from './routes/admin.js';

// ============================================
// ENV VALIDATION (fail fast)
// ============================================

const PORT = parseInt(process.env.API_PORT || '3001', 10);
const HOST = process.env.API_HOST || '0.0.0.0';

const requiredEnvVars = ['SUPABASE_URL', 'DATABASE_URL'] as const;
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`Missing required environment variable: ${envVar}`);
  }
}

// ============================================
// APP
// ============================================

async function main() {
  const fastify = Fastify({
    logger: {
      level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    },
    bodyLimit: 1_048_576, // 1MB
  });

  // Security headers
  await fastify.register(helmet, {
    contentSecurityPolicy: false, // API-only server, no HTML
  });

  // CORS
  await fastify.register(cors, {
    origin: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:5173'],
    credentials: true,
  });

  // Rate limiting
  await fastify.register(rateLimit, {
    max: 100,
    timeWindow: 60_000,
    errorResponseBuilder: (_request, context) => ({
      error: 'Too Many Requests',
      message: `Rate limit exceeded. Try again in ${Math.ceil((context.ttl || 0) / 1000)} seconds.`,
      statusCode: 429,
    }),
  });

  // Auth decorators (available to all scopes below)
  await fastify.register(authPlugin);

  // ============================================
  // PUBLIC ROUTES (no auth)
  // ============================================

  await fastify.register(healthRoutes, { prefix: '/health' });

  // ============================================
  // AUTHENTICATED ROUTES (JWT required)
  //
  // Everything registered inside this scope is
  // protected by default. Adding a new route file
  // here automatically requires a valid Supabase JWT.
  // ============================================

  await fastify.register(async function authenticatedScope(app) {
    app.addHook('preHandler', app.verifyJwt);

    await app.register(statsRoutes, { prefix: '/stats' });
    await app.register(casesRoutes, { prefix: '/cases' });

    // ------------------------------------------
    // ADMIN ROUTES (JWT + admin role)
    //
    // Inherits verifyJwt from parent scope, then
    // additionally checks for admin role.
    // ------------------------------------------
    await app.register(async function adminScope(adminApp) {
      adminApp.addHook('preHandler', adminApp.requireAdmin);

      await adminApp.register(adminRoutes, { prefix: '/admin' });
    });
  });

  // ============================================
  // LIFECYCLE
  // ============================================

  const shutdown = async () => {
    fastify.log.info('Shutting down...');
    await fastify.close();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  try {
    await fastify.listen({ port: PORT, host: HOST });
    fastify.log.info(`Server listening on ${HOST}:${PORT}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

main();
