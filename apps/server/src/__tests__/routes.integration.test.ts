import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server as HttpServer } from 'node:http';
import express from 'express';
import { router } from '../routes.js';
import { nanoid } from 'nanoid';
import { hashPassword, issueRefreshToken, rotateRefreshToken, signToken } from '../auth.js';
import { createUserOrNull, findUserByName, setUserPassword } from '../store.js';
import { prisma } from '../lib/prisma.js';
import { env } from '../env.js';

let httpServer: HttpServer;
let port: number;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', router);
  httpServer = createServer(app);
  await new Promise<void>((resolve) => {
    httpServer.listen(0, () => {
      const addr = httpServer.address();
      if (addr && typeof addr === 'object') port = addr.port;
      resolve();
    });
  });
});

afterAll(async () => {
  httpServer.closeAllConnections?.();
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

async function ensureUser(username: string) {
  const u = await findUserByName(username);
  if (u) return u;
  const created = await createUserOrNull(username, { isGuest: false });
  if (!created) throw new Error(`failed to create ${username}`);
  return created;
}

describe('reserved usernames', () => {
  it('rejects registration of a reserved username (case-insensitive)', async () => {
    const res = await fetch(`http://localhost:${port}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'Admin', password: 'a-valid-password' }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('USERNAME_TAKEN');
  });

  it('allows a non-reserved username', async () => {
    const uniq = `user_${nanoid(8)}`;
    // Use a random password so HIBP (k-anonymity check on registration) can't
    // flag it as breached — a fixed string like "a-valid-password" hits the
    // breach list with high count and turns this into a flaky test.
    const password = `Test_${nanoid(16)}`;
    const res = await fetch(`http://localhost:${port}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: uniq, password }),
    });
    expect([200, 201]).toContain(res.status);
  });
});

describe('POST /rooms rate limit (5/min/user)', () => {
  it('returns 429 on the 6th create within a minute', async () => {
    const host = await ensureUser('rate_host_rt');
    const tok = signToken(host.id);
    const body = JSON.stringify({
      name: 'rate room', playerCount: 2, timer: 60,
      isPublic: true, allowSpectators: true, blockingRule: false, hostToken: tok,
    });
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await fetch(`http://localhost:${port}/api/v1/rooms`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 5).every((s) => s === 201)).toBe(true);
    expect(statuses[5]).toBe(429);
  });
});

describe('GDPR endpoints', () => {
  it('GET /me/export returns the caller’s data as a downloadable JSON blob', async () => {
    const u = await ensureUser(`exporter_${nanoid(6)}`);
    const tok = signToken(u.id);
    const res = await fetch(`http://localhost:${port}/api/v1/me/export`, {
      headers: { authorization: `Bearer ${tok}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition') ?? '').toContain('attachment');
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.exportedAt).toBeTruthy();
    expect((body.user as { id: string }).id).toBe(u.id);
    expect(Array.isArray(body.eloRatings)).toBe(true);
    expect(Array.isArray(body.eloHistory)).toBe(true);
    expect(Array.isArray(body.games)).toBe(true);
    expect(Array.isArray(body.chatMessages)).toBe(true);
  });

  it('GET /me/export rejects unauthenticated requests', async () => {
    const res = await fetch(`http://localhost:${port}/api/v1/me/export`);
    expect(res.status).toBe(401);
  });

  it('DELETE /me anonymizes the user, preserves game history, and revokes sessions', async () => {
    const username = `deleter_${nanoid(6)}`;
    const user = await ensureUser(username);
    await setUserPassword(user.id, await hashPassword('secret-password-123'));
    const tok = signToken(user.id);

    // Seed a fake completed game so we can verify GamePlayer reassignment.
    const game = await prisma.game.create({
      data: {
        id: `g_${nanoid(8)}`,
        mode: 'casual',
        playerCount: 2,
        status: 'completed',
        settings: { blockingRule: false },
        startedAt: new Date(Date.now() - 60_000),
        endedAt: new Date(),
      },
    });
    const opponent = await ensureUser(`opp_${nanoid(6)}`);
    await prisma.gamePlayer.createMany({
      data: [
        { gameId: game.id, userId: user.id, color: 'red', homePoint: 0, seatOrder: 0, finishPos: 1 },
        { gameId: game.id, userId: opponent.id, color: 'blue', homePoint: 3, seatOrder: 1, finishPos: 2 },
      ],
    });
    await issueRefreshToken(user.id);

    // Wrong password → 401.
    const bad = await fetch(`http://localhost:${port}/api/v1/me`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'nope' }),
    });
    expect(bad.status).toBe(401);

    // Correct password → 204.
    const ok = await fetch(`http://localhost:${port}/api/v1/me`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'secret-password-123' }),
    });
    expect(ok.status).toBe(204);

    // User gone.
    const stillThere = await prisma.user.findUnique({ where: { id: user.id } });
    expect(stillThere).toBeNull();

    // GamePlayer row reassigned to the tombstone user.
    const reassigned = await prisma.gamePlayer.findFirst({
      where: { gameId: game.id, color: 'red' },
    });
    expect(reassigned?.userId).toMatch(/^deleted_user_/);

    // Opponent's game record intact.
    const opp = await prisma.gamePlayer.findFirst({
      where: { gameId: game.id, color: 'blue' },
    });
    expect(opp?.userId).toBe(opponent.id);

    // Sessions revoked: tokens for the user are gone (cascade) — none remain.
    const tokens = await prisma.refreshToken.findMany({ where: { userId: user.id } });
    expect(tokens.length).toBe(0);
  });
});

describe('GET /admin/games', () => {
  it('returns 404 to non-admin users', async () => {
    const u = await ensureUser(`nonadmin_${nanoid(6)}`);
    const tok = signToken(u.id);
    const res = await fetch(`http://localhost:${port}/api/v1/admin/games`, {
      headers: { authorization: `Bearer ${tok}` },
    });
    expect(res.status).toBe(404);
  });

  it('returns a games list when called by ADMIN_USER_ID', async () => {
    const admin = await ensureUser(`admin_${nanoid(6)}`);
    // Mutate the validated env at runtime — Zod parsed once at startup; this is a test-only knob.
    (env as { ADMIN_USER_ID?: string }).ADMIN_USER_ID = admin.id;
    const tok = signToken(admin.id);
    const res = await fetch(`http://localhost:${port}/api/v1/admin/games`, {
      headers: { authorization: `Bearer ${tok}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { games: unknown[]; totalActive: number };
    expect(Array.isArray(body.games)).toBe(true);
    expect(typeof body.totalActive).toBe('number');
    (env as { ADMIN_USER_ID?: string }).ADMIN_USER_ID = undefined;
  });
});

describe('refresh-token reuse detection', () => {
  it('revokes the entire family when a revoked token is presented', async () => {
    const user = await ensureUser('reuse_user_rt');
    // Clear any prior tokens from earlier test runs so updateMany counts are predictable.
    await prisma.refreshToken.deleteMany({ where: { userId: user.id } });

    const tokenA = await issueRefreshToken(user.id);
    const rotated = await rotateRefreshToken(tokenA);
    expect(rotated).not.toBeNull();
    const tokenB = rotated!.refreshToken;

    // Presenting A again (revoked) should return null AND revoke B.
    const reuseAttempt = await rotateRefreshToken(tokenA);
    expect(reuseAttempt).toBeNull();

    // B should now be unusable.
    const rotateB = await rotateRefreshToken(tokenB);
    expect(rotateB).toBeNull();
  });
});
