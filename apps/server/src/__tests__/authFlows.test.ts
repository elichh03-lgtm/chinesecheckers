import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server as HttpServer } from 'node:http';
import express from 'express';
import cookieParser from 'cookie-parser';
import { router } from '../routes.js';
import { prisma } from '../lib/prisma.js';

let httpServer: HttpServer;
let baseUrl: string;

// Disable HIBP network calls across this file — fail-open path is fine to assert
// independently in hibp.test.ts, but we don't want flaky network in flow tests.
beforeAll(async () => {
  const realFetch = globalThis.fetch.bind(globalThis);
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (...args) => {
    const url = typeof args[0] === 'string' ? args[0] : (args[0] as Request).url;
    if (url.startsWith('https://api.pwnedpasswords.com/')) {
      return new Response('', { status: 500 });
    }
    return realFetch(...(args as Parameters<typeof fetch>));
  });
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/v1', router);
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    // eslint-disable-next-line no-console
    console.error('[test app] handler threw:', err);
    res.status(500).json({ error: String((err as Error)?.message ?? err) });
  });
  httpServer = createServer(app);
  await new Promise<void>((resolve) => {
    httpServer.listen(0, () => {
      const addr = httpServer.address();
      if (addr && typeof addr === 'object') {
        baseUrl = `http://127.0.0.1:${addr.port}/api/v1`;
      }
      resolve();
    });
  });
});

afterAll(async () => {
  httpServer.closeAllConnections?.();
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  vi.restoreAllMocks();
});

function uniq(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;
}

function parseSetCookies(res: Response): Record<string, { value: string; raw: string }> {
  const out: Record<string, { value: string; raw: string }> = {};
  // Node's fetch concatenates multiple Set-Cookie headers with commas; split carefully.
  const header = res.headers.get('set-cookie');
  if (!header) return out;
  // headers.getSetCookie is available on Node 20.
  const all =
    typeof (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie === 'function'
      ? (res.headers as unknown as { getSetCookie: () => string[] }).getSetCookie()
      : [header];
  for (const raw of all) {
    const [pair] = raw.split(';');
    const eq = pair!.indexOf('=');
    if (eq < 0) continue;
    const name = pair!.slice(0, eq).trim();
    const value = pair!.slice(eq + 1).trim();
    out[name] = { value, raw };
  }
  return out;
}

async function register(username: string, password = 'StrongPass_1234'): Promise<{
  token: string;
  cookies: Record<string, { value: string; raw: string }>;
  userId: string;
}> {
  const res = await fetch(`${baseUrl}/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { user: { id: string }; token: string };
  return {
    token: body.token,
    userId: body.user.id,
    cookies: parseSetCookies(res),
  };
}

describe('cookie-based auth flow', () => {
  it('register sets HttpOnly cc_rt cookie and csrf cookie; body has no refreshToken', async () => {
    const username = uniq('reg');
    const res = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password: 'StrongPass_1234' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.refreshToken).toBeUndefined();
    expect(body.token).toBeTypeOf('string');

    const cookies = parseSetCookies(res);
    expect(cookies['cc_rt']).toBeDefined();
    expect(cookies['cc_rt']!.raw).toMatch(/HttpOnly/i);
    expect(cookies['cc_rt']!.raw).toMatch(/SameSite=Strict/i);
    expect(cookies['cc_rt']!.raw).toMatch(/Path=\/api\/v1\/auth/i);
    expect(cookies['csrf']).toBeDefined();
    expect(cookies['csrf']!.raw).not.toMatch(/HttpOnly/i);
  });

  it('refresh requires the csrf header to match the csrf cookie', async () => {
    const { cookies } = await register(uniq('csrf'));
    const rt = cookies['cc_rt']!.value;
    const csrf = cookies['csrf']!.value;

    // Without the x-csrf header → 403
    const no = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { cookie: `cc_rt=${rt}; csrf=${csrf}` },
    });
    expect(no.status).toBe(403);

    // With matching header → 200, rotates cookie
    const ok = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { cookie: `cc_rt=${rt}; csrf=${csrf}`, 'x-csrf': csrf },
    });
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as Record<string, unknown>;
    expect(body.token).toBeTypeOf('string');
    expect(body.refreshToken).toBeUndefined();
    const nextCookies = parseSetCookies(ok);
    expect(nextCookies['cc_rt']).toBeDefined();
    expect(nextCookies['cc_rt']!.value).not.toBe(rt);
  });

  it('refresh with mismatched csrf returns 403', async () => {
    const { cookies } = await register(uniq('csrfbad'));
    const rt = cookies['cc_rt']!.value;
    const csrf = cookies['csrf']!.value;
    const res = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { cookie: `cc_rt=${rt}; csrf=${csrf}`, 'x-csrf': 'wrong-value' },
    });
    expect(res.status).toBe(403);
  });

  it('refresh without a cc_rt cookie returns 401', async () => {
    const { cookies } = await register(uniq('nocookie'));
    const csrf = cookies['csrf']!.value;
    const res = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { cookie: `csrf=${csrf}`, 'x-csrf': csrf },
    });
    expect(res.status).toBe(401);
  });

  it('logout clears the cc_rt cookie', async () => {
    const { token } = await register(uniq('logout'));
    const res = await fetch(`${baseUrl}/auth/logout`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const cookies = parseSetCookies(res);
    expect(cookies['cc_rt']).toBeDefined();
    // express clearCookie sets value to empty + Expires in the past
    expect(cookies['cc_rt']!.raw).toMatch(/Expires=|Max-Age=0/i);
  });

  it('logout still revokes + clears cookies when the access token has expired', async () => {
    // Review fix: an expired Bearer should NOT prevent server-side session
    // teardown. Cookie-side cleanup still happens and refresh tokens are
    // revoked via the cookie's hash lookup.
    const { userId, cookies } = await register(uniq('logoutexp'));
    const rt = cookies['cc_rt']!.value;
    const expiredAccess = (await import('../auth.js')).signToken(userId, -1000);
    const res = await fetch(`${baseUrl}/auth/logout`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${expiredAccess}`,
        cookie: `cc_rt=${rt}`,
      },
    });
    expect(res.status).toBe(200);
    const out = parseSetCookies(res);
    expect(out['cc_rt']!.raw).toMatch(/Expires=|Max-Age=0/i);
    const active = await prisma.refreshToken.findMany({
      where: { userId, revokedAt: null },
    });
    expect(active.length).toBe(0);
  });
});

describe('password reset flow', () => {
  beforeEach(() => {
    // Ensure HIBP mock is in place.
  });

  it('forgot returns 200 for unknown user (no enumeration)', async () => {
    const res = await fetch(`${baseUrl}/auth/forgot`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: uniq('nobody') }),
    });
    expect(res.status).toBe(200);
  });

  it('forgot + reset rotates the password, marks token used, revokes refresh tokens', async () => {
    const username = uniq('reset');
    const oldPassword = 'OldPass_1234';
    const newPassword = 'NewPass_1234';
    const { userId } = await register(username, oldPassword);

      // /auth/forgot only issues a reset for users with an email on file, so
    // backfill one for this test user before triggering the flow.
    await prisma.user.update({ where: { id: userId }, data: { email: `${username}@test.local` } });

    const forgot = await fetch(`${baseUrl}/auth/forgot`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username }),
    });
    expect(forgot.status).toBe(200);

    // Read the unhashed token straight from DB by looking up the most recent
    // PasswordReset row for this user — same way the console.log emitted it
    // but more reliable in a test.
    const reset = await prisma.passwordReset.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    expect(reset).toBeTruthy();
    // The raw token is gone — we only have the hash. So we need to capture
    // it from console.log. Re-run forgot but intercept the log this time.
    const { JSON_OUTBOX_PATH } = await import('../lib/mailer.js');
    const fs = await import('node:fs');
    const before = fs.existsSync(JSON_OUTBOX_PATH)
      ? fs.readFileSync(JSON_OUTBOX_PATH, 'utf8').length
      : 0;
    const forgot2 = await fetch(`${baseUrl}/auth/forgot`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username }),
    });
    expect(forgot2.status).toBe(200);
    const after = fs.readFileSync(JSON_OUTBOX_PATH, 'utf8');
    const newContent = after.slice(before);
    const tokenMatch = newContent.match(/\/reset\?token=([^"\s\\]+)/);
    expect(tokenMatch).toBeTruthy();
    const rawToken = decodeURIComponent(tokenMatch![1]!);

    const resetRes = await fetch(`${baseUrl}/auth/reset`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: rawToken, newPassword }),
    });
    expect(resetRes.status).toBe(200);

    // All pre-reset refresh tokens for the user should be revoked.
    // (Checked here, before the new-password login that issues a fresh one.)
    const active = await prisma.refreshToken.findMany({
      where: { userId, revokedAt: null },
    });
    expect(active.length).toBe(0);

    // Old password no longer works.
    const failed = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password: oldPassword }),
    });
    expect(failed.status).toBe(401);

    // New password works.
    const ok = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password: newPassword }),
    });
    expect(ok.status).toBe(200);

    // Reusing the same reset token should fail.
    const reused = await fetch(`${baseUrl}/auth/reset`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: rawToken, newPassword: 'AnotherPass_99' }),
    });
    expect(reused.status).toBe(400);
  });

  it('reset with garbage token returns 400', async () => {
    const res = await fetch(`${baseUrl}/auth/reset`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'a'.repeat(40), newPassword: 'WhateverGoes_1' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('/me/sessions', () => {
  it('lists active sessions and marks the current one', async () => {
    const { token, userId, cookies } = await register(uniq('sess'));
    const rt = cookies['cc_rt']!.value;

    // Open a "second" session by hitting login again.
    const res = await fetch(`${baseUrl}/me/sessions`, {
      headers: { authorization: `Bearer ${token}`, cookie: `cc_rt=${rt}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sessions: Array<{ id: string; current: boolean }> };
    expect(body.sessions.length).toBeGreaterThanOrEqual(1);
    expect(body.sessions.some((s) => s.current)).toBe(true);

    // Issue a second refresh token by calling refresh once.
    const csrf = cookies['csrf']!.value;
    const r2 = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { cookie: `cc_rt=${rt}; csrf=${csrf}`, 'x-csrf': csrf },
    });
    expect(r2.status).toBe(200);
    const r2cookies = parseSetCookies(r2);
    const newRt = r2cookies['cc_rt']!.value;

    // List again using new cookie — should still see exactly one current row.
    const res2 = await fetch(`${baseUrl}/me/sessions`, {
      headers: { authorization: `Bearer ${token}`, cookie: `cc_rt=${newRt}` },
    });
    const body2 = (await res2.json()) as { sessions: Array<{ id: string; current: boolean }> };
    expect(body2.sessions.filter((s) => s.current).length).toBe(1);

    // Revoke the (only) session row that isn't current — if there's only one,
    // revoke the current one and confirm 204.
    const target = body2.sessions[0]!;
    const del = await fetch(`${baseUrl}/me/sessions/${target.id}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(del.status).toBe(204);

    expect(userId).toBeTypeOf('string');
  });

  it('rejects revoking a session that belongs to another user', async () => {
    const a = await register(uniq('a'));
    const b = await register(uniq('b'));
    // Get one of A's session IDs.
    const list = await fetch(`${baseUrl}/me/sessions`, {
      headers: { authorization: `Bearer ${a.token}` },
    });
    const body = (await list.json()) as { sessions: Array<{ id: string }> };
    const targetId = body.sessions[0]!.id;
    // B tries to revoke it → 404.
    const del = await fetch(`${baseUrl}/me/sessions/${targetId}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${b.token}` },
    });
    expect(del.status).toBe(404);
  });

  it('rejects unauthenticated callers', async () => {
    const list = await fetch(`${baseUrl}/me/sessions`);
    expect(list.status).toBe(401);
  });
});
