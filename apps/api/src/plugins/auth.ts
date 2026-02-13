import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { prisma } from '@ilr/db';
import type { AuthUser } from '@ilr/shared';

// ============================================
// CONFIGURATION
// ============================================

const SUPABASE_URL = process.env.SUPABASE_URL;

if (!SUPABASE_URL) {
  throw new Error(
    'SUPABASE_URL environment variable is required. ' +
    'Set it to your Supabase project URL (e.g. https://xxx.supabase.co).'
  );
}

const JWKS_URL = new URL(`${SUPABASE_URL}/auth/v1/keys`);
const ISSUER = `${SUPABASE_URL}/auth/v1`;

// JWKS client — cached and reused across requests
const jwks = createRemoteJWKSet(JWKS_URL);

// ============================================
// TYPE EXTENSIONS
// ============================================

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
  interface FastifyInstance {
    verifyJwt: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireAdmin: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

interface JwtPayload {
  sub: string;
  email?: string;
  role?: string;
  aud: string;
  exp: number;
}

// ============================================
// PLUGIN
// ============================================

export async function authPlugin(fastify: FastifyInstance) {
  /**
   * Verifies the Supabase JWT from the Authorization header,
   * then looks up the user's role in our database.
   *
   * Use as a preHandler hook on routes/scopes that require authentication.
   */
  fastify.decorate('verifyJwt', async function (request: FastifyRequest, reply: FastifyReply) {
    const authHeader = request.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      return reply.status(401).send({
        error: 'Unauthorized',
        message: 'Missing or invalid authorization header',
        statusCode: 401,
      });
    }

    const token = authHeader.slice(7);

    try {
      const { payload } = await jwtVerify(token, jwks, {
        issuer: ISSUER,
        audience: 'authenticated',
      });

      const jwtPayload = payload as unknown as JwtPayload;

      // Get user role from our database (never trust client-supplied roles)
      const userRole = await prisma.userRole.findUnique({
        where: { userId: jwtPayload.sub },
      });

      request.user = {
        id: jwtPayload.sub,
        email: jwtPayload.email || '',
        role: userRole?.role === 'admin' ? 'admin' : 'user',
      };
    } catch (err) {
      fastify.log.warn(err, 'JWT verification failed');
      return reply.status(401).send({
        error: 'Unauthorized',
        message: 'Invalid or expired token',
        statusCode: 401,
      });
    }
  });

  /**
   * Checks that the already-authenticated user has admin role.
   *
   * IMPORTANT: This assumes verifyJwt has already run (e.g. via a parent scope hook).
   * Always use this AFTER verifyJwt, never standalone.
   */
  fastify.decorate('requireAdmin', async function (request: FastifyRequest, reply: FastifyReply) {
    if (!request.user) {
      return reply.status(401).send({
        error: 'Unauthorized',
        message: 'Authentication required',
        statusCode: 401,
      });
    }

    if (request.user.role !== 'admin') {
      return reply.status(403).send({
        error: 'Forbidden',
        message: 'Admin access required',
        statusCode: 403,
      });
    }
  });
}
