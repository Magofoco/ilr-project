import type { FastifyInstance } from 'fastify';

export async function authRoutes(fastify: FastifyInstance) {
  /**
   * GET /auth/me
   *
   * Returns the authenticated user's identity + resolved role.
   *
   * The role is read by `verifyJwt` from the `user_roles` table — we never
   * trust the client to tell us what role it is. The frontend uses this to
   * (1) confirm the JWT is valid and (2) decide whether to show admin UI.
   */
  fastify.get('/me', async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({
        error: 'Unauthorized',
        message: 'Authentication required',
        statusCode: 401,
      });
    }

    return request.user;
  });
}
