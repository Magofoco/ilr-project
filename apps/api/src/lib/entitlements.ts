/**
 * Entitlement checks for the API. A user is considered to have paid access
 * to ILR Tracker if any of these is true:
 *
 *   1. They have an active `ILR_TRACKER` Entitlement row (status='active',
 *      not yet expired, not revoked). This is the normal post-Stripe path.
 *   2. Their UserRole is ADMIN. Admins always see everything — both for
 *      internal QA and so that we can grant access manually without a
 *      separate flow.
 *
 * The check is centralized here so the various routes (currently just
 * /estimate, later /export, /api-keys, etc.) stay consistent and we have
 * one place to add caching / metrics / kill-switches.
 */
import { prisma, Product } from '@ilr/db';

/**
 * Does the given user currently have paid access to the ILR_TRACKER product?
 *
 * Returns `false` (not throws) when:
 *   - The user isn't found
 *   - No active entitlement exists
 *   - The entitlement exists but is expired or revoked
 *
 * Admin role short-circuits to `true` without any entitlement check.
 */
export async function hasIlrTrackerEntitlement(userId: string): Promise<boolean> {
  const [role, entitlement] = await Promise.all([
    prisma.userRole.findUnique({
      where: { userId },
      select: { role: true },
    }),
    prisma.entitlement.findFirst({
      where: {
        userId,
        product: Product.ILR_TRACKER,
        status: 'active',
        revokedAt: null,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } },
        ],
      },
      select: { id: true },
    }),
  ]);

  if (role?.role === 'ADMIN') return true;
  return entitlement !== null;
}
