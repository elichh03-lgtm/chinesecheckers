import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { env } from './env.js';
import { prisma } from './lib/prisma.js';
import { audit } from './lib/audit.js';

/**
 * Auth primitives.
 *
 *   - Access tokens are short-lived JWTs (15 min) signed with `JWT_SECRET`.
 *     `verifyToken(token)` returns the user id or `null`.
 *
 *   - Refresh tokens are random opaque strings; the SHA-256 hash is stored in
 *     `RefreshToken`. Rotation: each refresh issues a new pair and revokes the
 *     prior token.
 *
 *   - Passwords are bcrypt-hashed (cost 10). Guest accounts have `null`
 *     `passwordHash` and authenticate by re-using their stored token.
 */

const ACCESS_TTL_MS = 15 * 60 * 1000;
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const BCRYPT_COST = 10;

type AccessPayload = { sub: string };

export function signToken(userId: string, ttlMs: number = ACCESS_TTL_MS): string {
  // Compute exp directly so negative TTLs (used in tests for expired tokens)
  // don't trip jsonwebtoken's option validation.
  const now = Math.floor(Date.now() / 1000);
  const payload: AccessPayload & { iat: number; exp: number } = {
    sub: userId,
    iat: now,
    exp: now + Math.floor(ttlMs / 1000),
  };
  return jwt.sign(payload, env.JWT_SECRET);
}

export function verifyToken(token: string): string | null {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET);
    if (typeof decoded === 'object' && decoded && typeof (decoded as { sub?: unknown }).sub === 'string') {
      return (decoded as { sub: string }).sub;
    }
    return null;
  } catch {
    return null;
  }
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

function hashRefresh(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function issueRefreshToken(userId: string): Promise<string> {
  const raw = randomBytes(32).toString('base64url');
  const tokenHash = hashRefresh(raw);
  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash,
      expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    },
  });
  return raw;
}

/**
 * Validate + rotate. Returns a new access+refresh pair (and revokes the prior
 * refresh) on success, or null if the token is unknown / expired / revoked.
 */
export async function rotateRefreshToken(
  oldToken: string,
): Promise<{ userId: string; accessToken: string; refreshToken: string } | null> {
  const tokenHash = hashRefresh(oldToken);
  const record = await prisma.refreshToken.findUnique({ where: { tokenHash } });
  if (!record) return null;
  if (record.revokedAt) {
    // Reuse of a revoked token => treat as compromise, revoke entire family.
    await revokeAllRefreshTokens(record.userId);
    await audit({
      userId: record.userId,
      action: 'refresh.family_revoked',
      metadata: { reason: 'reuse_of_revoked_token', tokenId: record.id },
    });
    return null;
  }
  if (record.expiresAt.getTime() <= Date.now()) return null;

  await prisma.refreshToken.update({
    where: { id: record.id },
    data: { revokedAt: new Date(), lastUsedAt: new Date() },
  });
  const accessToken = signToken(record.userId);
  const refreshToken = await issueRefreshToken(record.userId);
  return { userId: record.userId, accessToken, refreshToken };
}

export function hashRefreshToken(token: string): string {
  return hashRefresh(token);
}

export async function revokeAllRefreshTokens(userId: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/**
 * Review fix: prune stale refresh-token rows. We delete rows that are past
 * `expiresAt` *and* tombstoned rows that were revoked more than 30 days ago
 * (kept around briefly so /me/sessions can show recent activity). Returns
 * the number of rows deleted.
 */
const REVOKED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export async function cleanupExpiredRefreshTokens(now: Date = new Date()): Promise<number> {
  const revokedCutoff = new Date(now.getTime() - REVOKED_RETENTION_MS);
  const result = await prisma.refreshToken.deleteMany({
    where: {
      OR: [
        { expiresAt: { lt: now } },
        { revokedAt: { lt: revokedCutoff } },
      ],
    },
  });
  return result.count;
}
