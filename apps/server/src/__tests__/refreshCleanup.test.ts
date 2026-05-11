import { describe, expect, it } from 'vitest';
import { nanoid } from 'nanoid';
import { createHash } from 'node:crypto';
import { cleanupExpiredRefreshTokens } from '../auth.js';
import { prisma } from '../lib/prisma.js';
import { createUserOrNull } from '../store.js';

// Review fix: prove that cleanupExpiredRefreshTokens removes (a) past-expiry
// rows and (b) tombstoned rows older than the 30-day retention window, while
// preserving still-valid and recently-revoked rows.
describe('cleanupExpiredRefreshTokens', () => {
  it('deletes expired and long-revoked rows, keeps valid and recent-revoked rows', async () => {
    const user = await createUserOrNull(`cleanup_${nanoid(6)}`, { isGuest: false });
    expect(user).toBeTruthy();
    const userId = user!.id;
    const now = Date.now();
    const hash = (s: string): string => createHash('sha256').update(s).digest('hex');

    const expiredId = nanoid();
    const oldRevokedId = nanoid();
    const recentRevokedId = nanoid();
    const validId = nanoid();

    await prisma.refreshToken.createMany({
      data: [
        {
          id: expiredId,
          userId,
          tokenHash: hash(`expired_${expiredId}`),
          expiresAt: new Date(now - 60_000),
        },
        {
          id: oldRevokedId,
          userId,
          tokenHash: hash(`oldrev_${oldRevokedId}`),
          expiresAt: new Date(now + 24 * 60 * 60 * 1000),
          revokedAt: new Date(now - 31 * 24 * 60 * 60 * 1000),
        },
        {
          id: recentRevokedId,
          userId,
          tokenHash: hash(`recent_${recentRevokedId}`),
          expiresAt: new Date(now + 24 * 60 * 60 * 1000),
          revokedAt: new Date(now - 60 * 1000),
        },
        {
          id: validId,
          userId,
          tokenHash: hash(`valid_${validId}`),
          expiresAt: new Date(now + 24 * 60 * 60 * 1000),
        },
      ],
    });

    const deleted = await cleanupExpiredRefreshTokens(new Date(now));
    expect(deleted).toBeGreaterThanOrEqual(2);

    const remaining = await prisma.refreshToken.findMany({
      where: { id: { in: [expiredId, oldRevokedId, recentRevokedId, validId] } },
      select: { id: true },
    });
    const ids = remaining.map((r) => r.id);
    expect(ids).not.toContain(expiredId);
    expect(ids).not.toContain(oldRevokedId);
    expect(ids).toContain(recentRevokedId);
    expect(ids).toContain(validId);
  });
});
