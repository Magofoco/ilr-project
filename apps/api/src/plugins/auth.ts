import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { prisma } from '@ilr/db';
import type { AuthUser } from '@ilr/shared';

// Supabase JWKS endpoint
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const JWKS_URL = `${SUPABASE_URL}/auth/v1/keys`;

// Create JWKS client (cached)
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJwks() {
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(JWKS_URL));
  }
  return jwks;
}

// Extend FastifyRequest with user
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

export async function authPlugin(fastify: FastifyInstance) {
  // JWT verification hook
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
      const { payload } = await jwtVerify(token, getJwks(), {
        issuer: `${SUPABASE_URL}/auth/v1`,
        audience: 'authenticated',
      });

      const jwtPayload = payload as unknown as JwtPayload;

      // Get user role from our database
      const userRole = await prisma.userRole.findUnique({
        where: { userId: jwtPayload.sub },
      });

      request.user = {
        id: jwtPayload.sub,
        email: jwtPayload.email || '',
        role: userRole?.role === 'admin' ? 'admin' : 'user',
      };
    } catch (err) {
      fastify.log.error(err, 'JWT verification failed');
      return reply.status(401).send({
        error: 'Unauthorized',
        message: 'Invalid or expired token',
        statusCode: 401,
      });
    }
  });

  // Admin requirement hook
  fastify.decorate('requireAdmin', async function (request: FastifyRequest, reply: FastifyReply) {
    // First verify JWT
    await fastify.verifyJwt(request, reply);
    
    // Check if already sent response (error case)
    if (reply.sent) return;
    
    if (request.user?.role !== 'admin') {
      return reply.status(403).send({
        error: 'Forbidden',
        message: 'Admin access required',
        statusCode: 403,
      });
    }
  });
}
