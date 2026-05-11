import { Router, type Request, type Response, type Router as RouterType } from 'express';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  createUserOrNull,
  createRoom,
  getRoom,
  listAllRooms,
  listPublicRooms,
  getUser,
  setUserPassword,
  findUserByName,
  findOrCreateUserByGoogleId,
  getProfile,
  updateUserProfile,
} from './store.js';
import {
  hashPassword,
  hashRefreshToken,
  issueRefreshToken,
  revokeAllRefreshTokens,
  rotateRefreshToken,
  signToken,
  verifyPassword,
  verifyToken,
} from './auth.js';
import { rateLimit } from './rateLimit.js';
import { prisma } from './lib/prisma.js';
import { env, googleConfigured, googleCallbackUrl, s3Configured } from './env.js';
import { getAvatarPresignedPutUrl } from './lib/s3.js';
import { isPwned } from './lib/hibp.js';
import { sendPasswordReset } from './lib/mailer.js';
import { logger } from './lib/logger.js';
import { redis } from './lib/redis.js';
import { audit, ipFromReq, uaFromReq } from './lib/audit.js';
import * as Sentry from '@sentry/node';

function getAuthUserId(req: Request): string | null {
  const auth = req.header('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : auth;
  if (!token) return null;
  return verifyToken(token);
}

// ────────────────────────── Cookie helpers ──────────────────────────

const REFRESH_COOKIE = 'cc_rt';
const CSRF_COOKIE = 'csrf';
const REFRESH_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const REFRESH_COOKIE_PATH = '/api/v1/auth';

function isProd(): boolean {
  return env.NODE_ENV === 'production';
}

function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: isProd(),
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH,
    maxAge: REFRESH_COOKIE_MAX_AGE_MS,
  });
}

function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, {
    httpOnly: true,
    secure: isProd(),
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH,
  });
}

function setCsrfCookie(res: Response): string {
  const value = randomBytes(32).toString('hex');
  res.cookie(CSRF_COOKIE, value, {
    httpOnly: false,
    secure: isProd(),
    sameSite: 'strict',
    path: '/',
    maxAge: REFRESH_COOKIE_MAX_AGE_MS,
  });
  return value;
}

function clearCsrfCookie(res: Response): void {
  res.clearCookie(CSRF_COOKIE, { path: '/' });
}

function csrfOk(req: Request): boolean {
  const cookieVal = (req.cookies as Record<string, string | undefined>)?.[CSRF_COOKIE];
  const header = req.header('x-csrf');
  if (!cookieVal || !header) return false;
  const a = Buffer.from(cookieVal, 'utf8');
  const b = Buffer.from(header, 'utf8');
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export const router: RouterType = Router();

router.get('/ready', async (_req, res): Promise<void> => {
  res.setHeader('Cache-Control', 'no-store');
  const checks: { db: boolean; redis: boolean; dbError?: string; redisError?: string } = {
    db: false,
    redis: false,
  };
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.db = true;
  } catch (err) {
    checks.dbError = (err as Error).message;
    logger.error({ err }, 'readiness: db check failed');
  }
  try {
    const pong = await redis.ping();
    checks.redis = pong === 'PONG';
    if (!checks.redis) checks.redisError = `unexpected reply: ${pong}`;
  } catch (err) {
    checks.redisError = (err as Error).message;
    logger.error({ err }, 'readiness: redis check failed');
  }
  const ok = checks.db && checks.redis;
  res.status(ok ? 200 : 503).json({ ok, ...checks });
});

const UsernameSchema = z.string().min(2).max(20).regex(/^[a-zA-Z0-9_]+$/);
const PasswordSchema = z.string().min(8).max(100);

const RegisterSchema = z.object({
  username: UsernameSchema,
  password: PasswordSchema,
  email: z.string().email().max(254).optional(),
});

const LoginSchema = z.object({
  username: UsernameSchema,
  password: PasswordSchema,
});

const ForgotSchema = z.object({ username: UsernameSchema });
const ResetSchema = z.object({
  token: z.string().min(20).max(200),
  newPassword: PasswordSchema,
});

// Separate buckets so a burst of failed logins (brute-force probing) doesn't
// block legitimate sign-ups from the same IP, and vice versa. Looser in
// non-prod so E2E suites that exercise these flows don't trip themselves.
const loginLimiter = rateLimit({
  windowMs: 60_000,
  max: env.NODE_ENV === 'production' ? 10 : 50,
});
const registerLimiter = rateLimit({
  windowMs: 60_000,
  max: env.NODE_ENV === 'production' ? 10 : 50,
});
const passwordResetLimiter = rateLimit({
  windowMs: 60_000,
  max: env.NODE_ENV === 'production' ? 10 : 50,
});

function logInvalidPayload(route: string, err: z.ZodError): void {
  logger.warn({ route, errors: err.flatten() }, 'invalid payload');
}

const createRoomLimiter = rateLimit({
  windowMs: 60_000,
  max: 5,
  keyFn: (req) => {
    const hostToken = (req.body as { hostToken?: unknown })?.hostToken;
    if (typeof hostToken === 'string') {
      const userId = verifyToken(hostToken);
      if (userId) return `user:${userId}`;
    }
    return `ip:${req.ip ?? req.socket.remoteAddress ?? 'unknown'}`;
  },
});

router.post('/auth/register', registerLimiter, async (req, res): Promise<void> => {
  const parsed = RegisterSchema.safeParse(req.body);
  if (!parsed.success) {
    logInvalidPayload('/auth/register', parsed.error);
    res.status(400).json({ error: 'INVALID_PAYLOAD' });
    return;
  }
  if (await isPwned(parsed.data.password)) {
    res.status(400).json({ error: 'PASSWORD_BREACHED' });
    return;
  }
  const user = await createUserOrNull(parsed.data.username, {
    isGuest: false,
    email: parsed.data.email ?? null,
  });
  if (!user) {
    res.status(409).json({ error: 'USERNAME_TAKEN' });
    return;
  }
  await setUserPassword(user.id, await hashPassword(parsed.data.password));
  const accessToken = signToken(user.id);
  const refreshToken = await issueRefreshToken(user.id);
  setRefreshCookie(res, refreshToken);
  setCsrfCookie(res);
  res.status(201).json({ user, token: accessToken });
});

router.post('/auth/login', loginLimiter, async (req, res): Promise<void> => {
  const parsed = LoginSchema.safeParse(req.body);
  if (!parsed.success) {
    logInvalidPayload('/auth/login', parsed.error);
    res.status(400).json({ error: 'INVALID_PAYLOAD' });
    return;
  }
  const user = await findUserByName(parsed.data.username, { withPasswordHash: true });
  if (!user || !user.passwordHash) {
    await audit({
      userId: user?.id ?? null,
      action: 'login.failure',
      metadata: { username: parsed.data.username, reason: 'unknown_user_or_no_password' },
      ipAddress: ipFromReq(req),
      userAgent: uaFromReq(req),
    });
    res.status(401).json({ error: 'INVALID_CREDENTIALS' });
    return;
  }
  const ok = await verifyPassword(parsed.data.password, user.passwordHash);
  if (!ok) {
    await audit({
      userId: user.id,
      action: 'login.failure',
      metadata: { username: parsed.data.username, reason: 'bad_password' },
      ipAddress: ipFromReq(req),
      userAgent: uaFromReq(req),
    });
    res.status(401).json({ error: 'INVALID_CREDENTIALS' });
    return;
  }
  const accessToken = signToken(user.id);
  const refreshToken = await issueRefreshToken(user.id);
  setRefreshCookie(res, refreshToken);
  setCsrfCookie(res);
  await audit({
    userId: user.id,
    action: 'login.success',
    metadata: { username: user.username },
    ipAddress: ipFromReq(req),
    userAgent: uaFromReq(req),
  });
  res.json({
    user: { id: user.id, username: user.username },
    token: accessToken,
  });
});

router.post('/auth/logout', async (req, res): Promise<void> => {
  // Review fix: don't bounce expired-access-token logout calls. Fall back to
  // looking the user up via the refresh-cookie hash so the session is still
  // killed and cookies are still cleared.
  const auth = req.header('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : auth;
  let userId = token ? verifyToken(token) : null;
  if (!userId) {
    const cookies = (req.cookies as Record<string, string | undefined>) ?? {};
    const cookieToken = cookies[REFRESH_COOKIE];
    if (cookieToken) {
      const record = await prisma.refreshToken.findUnique({
        where: { tokenHash: hashRefreshToken(cookieToken) },
      });
      if (record) userId = record.userId;
    }
  }
  if (userId) {
    await revokeAllRefreshTokens(userId);
  }
  clearRefreshCookie(res);
  clearCsrfCookie(res);
  res.json({ ok: true });
});

router.post('/auth/refresh', loginLimiter, async (req, res): Promise<void> => {
  if (!csrfOk(req)) {
    res.status(403).json({ error: 'CSRF' });
    return;
  }
  const cookies = (req.cookies as Record<string, string | undefined>) ?? {};
  const cookieToken = cookies[REFRESH_COOKIE];
  if (!cookieToken) {
    res.status(401).json({ error: 'NO_REFRESH_COOKIE' });
    return;
  }
  const result = await rotateRefreshToken(cookieToken);
  if (!result) {
    clearRefreshCookie(res);
    res.status(401).json({ error: 'INVALID_REFRESH_TOKEN' });
    return;
  }
  const user = await getUser(result.userId);
  if (!user) {
    clearRefreshCookie(res);
    res.status(401).json({ error: 'USER_NOT_FOUND' });
    return;
  }
  setRefreshCookie(res, result.refreshToken);
  setCsrfCookie(res);
  res.json({ user, token: result.accessToken });
});

// ────────────────────────── Password reset ──────────────────────────

const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

router.post('/auth/forgot', passwordResetLimiter, async (req, res): Promise<void> => {
  const parsed = ForgotSchema.safeParse(req.body);
  if (!parsed.success) {
    res.json({ ok: true });
    return;
  }
  const user = await prisma.user.findUnique({
    where: { username: parsed.data.username },
    select: { id: true, username: true, email: true, passwordHash: true },
  });
  if (user && user.passwordHash && user.email) {
    const token = randomBytes(32).toString('base64url');
    await prisma.passwordReset.create({
      data: {
        userId: user.id,
        tokenHash: sha256Hex(token),
        expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
      },
    });
    await audit({
      userId: user.id,
      action: 'password.reset.issued',
      metadata: { username: user.username },
      ipAddress: ipFromReq(req),
      userAgent: uaFromReq(req),
    });
    try {
      await sendPasswordReset({ to: user.email, username: user.username, token });
    } catch (err) {
      logger.error({ err, userId: user.id }, 'sendPasswordReset failed');
      Sentry.captureException(err);
    }
  }
  res.json({ ok: true });
});

router.post('/auth/reset', passwordResetLimiter, async (req, res): Promise<void> => {
  const parsed = ResetSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'INVALID_PAYLOAD' });
    return;
  }
  if (await isPwned(parsed.data.newPassword)) {
    res.status(400).json({ error: 'PASSWORD_BREACHED' });
    return;
  }
  const tokenHash = sha256Hex(parsed.data.token);
  const record = await prisma.passwordReset.findUnique({ where: { tokenHash } });
  if (!record || record.usedAt || record.expiresAt.getTime() <= Date.now()) {
    res.status(400).json({ error: 'INVALID_OR_EXPIRED_TOKEN' });
    return;
  }
  const newHash = await hashPassword(parsed.data.newPassword);
  await prisma.$transaction([
    prisma.passwordReset.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    }),
    prisma.user.update({
      where: { id: record.userId },
      data: { passwordHash: newHash },
    }),
    prisma.refreshToken.updateMany({
      where: { userId: record.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);
  await audit({
    userId: record.userId,
    action: 'password.reset.used',
    ipAddress: ipFromReq(req),
    userAgent: uaFromReq(req),
  });
  await audit({
    userId: record.userId,
    action: 'password.change',
    metadata: { via: 'reset' },
    ipAddress: ipFromReq(req),
    userAgent: uaFromReq(req),
  });
  clearRefreshCookie(res);
  clearCsrfCookie(res);
  res.json({ ok: true });
});

// ────────────────────────── Active sessions ──────────────────────────

router.get('/me/sessions', async (req, res): Promise<void> => {
  const userId = getAuthUserId(req);
  if (!userId) {
    res.status(401).json({ error: 'INVALID_TOKEN' });
    return;
  }
  const cookies = (req.cookies as Record<string, string | undefined>) ?? {};
  const cookieToken = cookies[REFRESH_COOKIE];
  const currentHash = cookieToken ? hashRefreshToken(cookieToken) : null;
  const rows = await prisma.refreshToken.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, tokenHash: true, createdAt: true, lastUsedAt: true },
  });
  res.json({
    sessions: rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      lastUsedAt: r.lastUsedAt,
      current: currentHash !== null && r.tokenHash === currentHash,
    })),
  });
});

router.delete('/me/sessions/:id', async (req, res): Promise<void> => {
  const userId = getAuthUserId(req);
  if (!userId) {
    res.status(401).json({ error: 'INVALID_TOKEN' });
    return;
  }
  const row = await prisma.refreshToken.findUnique({ where: { id: req.params.id! } });
  if (!row || row.userId !== userId) {
    res.status(404).json({ error: 'NOT_FOUND' });
    return;
  }
  if (!row.revokedAt) {
    await prisma.refreshToken.update({
      where: { id: row.id },
      data: { revokedAt: new Date() },
    });
  }
  res.status(204).end();
});

const CreateRoomSchema = z.object({
  name: z.string().min(1).max(50),
  playerCount: z.union([z.literal(2), z.literal(3), z.literal(4), z.literal(6)]),
  timer: z.number().min(15).max(180).optional().default(60),
  isPublic: z.boolean().default(true),
  allowSpectators: z.boolean().default(true),
  blockingRule: z.boolean().default(false),
  hostToken: z.string(),
});

router.post('/rooms', createRoomLimiter, async (req, res): Promise<void> => {
  const parsed = CreateRoomSchema.safeParse(req.body);
  if (!parsed.success) {
    logInvalidPayload('/rooms', parsed.error);
    res.status(400).json({ error: 'INVALID_PAYLOAD' });
    return;
  }
  const { hostToken, ...opts } = parsed.data;
  const userId = verifyToken(hostToken);
  const host = userId ? await getUser(userId) : undefined;
  if (!host) {
    res.status(401).json({ error: 'INVALID_TOKEN' });
    return;
  }
  const room = await createRoom({ host, ...opts });
  res.status(201).json({ gameId: room.gameId });
});

// The lobby polls /rooms every 2s. A 1s in-memory TTL coalesces concurrent
// pollers onto a single store fetch — at 100 clients × 30 req/min, we go from
// ~3000 store reads/min to ~60.
let roomsCache: { at: number; payload: { rooms: Awaited<ReturnType<typeof listPublicRooms>> } } | null = null;
const ROOMS_CACHE_TTL_MS = 1000;

router.get('/rooms', async (_req, res): Promise<void> => {
  const now = Date.now();
  if (!roomsCache || now - roomsCache.at > ROOMS_CACHE_TTL_MS) {
    roomsCache = { at: now, payload: { rooms: await listPublicRooms() } };
  }
  res.setHeader('Cache-Control', 'public, max-age=1');
  res.json(roomsCache.payload);
});

router.get('/games/:gameId', async (req, res): Promise<void> => {
  const game = await (await import('./lib/prisma.js')).prisma.game.findUnique({
    where: { id: req.params.gameId! },
    include: {
      players: {
        include: { user: { select: { id: true, username: true } } },
        orderBy: { seatOrder: 'asc' },
      },
      moves: { orderBy: { moveNumber: 'asc' } },
    },
  });
  if (!game) {
    res.status(404).json({ error: 'NOT_FOUND' });
    return;
  }
  // Completed games are immutable; let browsers cache the replay payload for
  // a day so re-watches don't hit the API at all.
  if (game.endedAt) {
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
  }
  res.json({
    gameId: game.id,
    playerCount: game.playerCount,
    settings: game.settings,
    startedAt: game.startedAt,
    endedAt: game.endedAt,
    players: game.players.map((p) => ({
      userId: p.userId,
      username: p.user.username,
      color: p.color,
      homePoint: p.homePoint,
      seatOrder: p.seatOrder,
      finishPos: p.finishPos,
      eloDelta: p.eloDelta,
    })),
    moves: game.moves.map((m) => ({
      moveNumber: m.moveNumber,
      userId: game.players.find((p) => p.id === m.playerId)?.userId,
      fromQ: m.fromQ,
      fromR: m.fromR,
      toQ: m.toQ,
      toR: m.toR,
      path: m.path as unknown as Array<{ q: number; r: number }>,
      isTimeout: m.isTimeout,
    })),
  });
});

router.get('/users/:username/games', async (req, res): Promise<void> => {
  const { prisma } = await import('./lib/prisma.js');
  const user = await prisma.user.findUnique({ where: { username: req.params.username! } });
  if (!user) {
    res.status(404).json({ error: 'NOT_FOUND' });
    return;
  }
  const players = await prisma.gamePlayer.findMany({
    where: { userId: user.id },
    include: {
      game: { select: { id: true, playerCount: true, mode: true, endedAt: true } },
    },
    orderBy: { game: { endedAt: 'desc' } },
    take: 50,
  });
  res.json({
    games: players
      .filter((p) => p.game.endedAt)
      .map((p) => ({
        gameId: p.gameId,
        playerCount: p.game.playerCount,
        mode: p.game.mode,
        endedAt: p.game.endedAt,
        finishPos: p.finishPos,
        eloDelta: p.eloDelta,
      })),
  });
});

router.get('/users/:username', async (req, res): Promise<void> => {
  const { prisma } = await import('./lib/prisma.js');
  const user = await prisma.user.findUnique({
    where: { username: req.params.username! },
    select: {
      id: true,
      username: true,
      avatarUrl: true,
      createdAt: true,
      eloRatings: { select: { mode: true, rating: true, gamesPlayed: true, wins: true, losses: true } },
    },
  });
  if (!user) {
    res.status(404).json({ error: 'NOT_FOUND' });
    return;
  }
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json(user);
});

router.get('/leaderboard', async (req, res): Promise<void> => {
  const { prisma } = await import('./lib/prisma.js');
  const mode = req.query.mode === '2p' ? '2p' : 'multi';
  const top = await prisma.eloRating.findMany({
    where: { mode },
    orderBy: { rating: 'desc' },
    take: 50,
    include: { user: { select: { username: true } } },
  });
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.json({
    mode,
    rows: top.map((r, i) => ({
      rank: i + 1,
      username: r.user.username,
      rating: r.rating,
      gamesPlayed: r.gamesPlayed,
      wins: r.wins,
      losses: r.losses,
    })),
  });
});

router.get('/rooms/:gameId', async (req, res): Promise<void> => {
  const room = await getRoom(req.params.gameId!);
  if (!room) {
    res.status(404).json({ error: 'NOT_FOUND' });
    return;
  }
  res.json({
    gameId: room.gameId,
    name: room.name,
    playerCount: room.playerCount,
    timer: room.timer,
    players: room.players,
    status: room.state?.status ?? 'waiting',
    hostUserId: room.hostUserId,
  });
});

// ────────────────────────── GDPR: export ──────────────────────────

const exportLimiter = rateLimit({ windowMs: 60_000, max: 3 });

router.get('/me/export', exportLimiter, async (req, res): Promise<void> => {
  const userId = getAuthUserId(req);
  if (!userId) {
    res.status(401).json({ error: 'INVALID_TOKEN' });
    return;
  }
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      username: true,
      email: true,
      avatarUrl: true,
      createdAt: true,
      lastSeenAt: true,
    },
  });
  if (!user) {
    res.status(404).json({ error: 'NOT_FOUND' });
    return;
  }

  const [eloRatings, eloHistory, gamePlayers, chatMessages] = await Promise.all([
    prisma.eloRating.findMany({ where: { userId } }),
    prisma.eloHistory.findMany({ where: { userId } }),
    prisma.gamePlayer.findMany({
      where: { userId },
      include: {
        game: {
          include: {
            players: {
              select: {
                userId: true,
                color: true,
                homePoint: true,
                seatOrder: true,
                finishPos: true,
                eloDelta: true,
              },
            },
            moves: true,
          },
        },
      },
    }),
    prisma.chatMessage.findMany({ where: { userId } }),
  ]);

  const games = gamePlayers.map((gp) => ({
    gameId: gp.gameId,
    mode: gp.game.mode,
    playerCount: gp.game.playerCount,
    settings: gp.game.settings,
    startedAt: gp.game.startedAt,
    endedAt: gp.game.endedAt,
    myFinishPos: gp.finishPos,
    myEloDelta: gp.eloDelta,
    players: gp.game.players,
    moves: gp.game.moves.map((m) => ({
      moveNumber: m.moveNumber,
      fromQ: m.fromQ,
      fromR: m.fromR,
      toQ: m.toQ,
      toR: m.toR,
      path: m.path as unknown as Array<{ q: number; r: number }>,
      isTimeout: m.isTimeout,
      timestamp: m.timestamp,
    })),
  }));

  const payload = {
    exportedAt: new Date().toISOString(),
    user,
    eloRatings,
    eloHistory,
    games,
    chatMessages,
  };

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="cc-data-${userId}.json"`);
  res.send(JSON.stringify(payload, null, 2));
});

// ────────────────────────── GDPR: delete ──────────────────────────

const DeleteAccountSchema = z.object({ password: z.string().min(1) });
const deleteLimiter = rateLimit({ windowMs: 60_000, max: 5 });

router.delete('/me', deleteLimiter, async (req, res): Promise<void> => {
  const userId = getAuthUserId(req);
  if (!userId) {
    res.status(401).json({ error: 'INVALID_TOKEN' });
    return;
  }
  const parsed = DeleteAccountSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, username: true, passwordHash: true },
  });
  if (!user) {
    res.status(404).json({ error: 'NOT_FOUND' });
    return;
  }
  if (!user.passwordHash) {
    res.status(400).json({ error: 'NO_PASSWORD_SET' });
    return;
  }
  const ok = await verifyPassword(parsed.data.password, user.passwordHash);
  if (!ok) {
    res.status(401).json({ error: 'INVALID_PASSWORD' });
    return;
  }

  const synthId = `deleted_user_${userId}`;
  const synthUsername = `deleted_user_${nanoid(8)}`;

  await prisma.$transaction(async (tx) => {
    await tx.user.create({
      data: {
        id: synthId,
        username: synthUsername,
        isGuest: true,
      },
    });
    await tx.gamePlayer.updateMany({ where: { userId }, data: { userId: synthId } });
    await tx.chatMessage.updateMany({ where: { userId }, data: { userId: synthId } });
    await tx.user.delete({ where: { id: userId } });
  });

  // Defensive — cascade already removed refresh tokens, but no-op is cheap.
  await revokeAllRefreshTokens(userId).catch(() => undefined);

  await audit({
    userId: null,
    action: 'account.deleted',
    metadata: { originalUserId: userId, originalUsername: user.username, synthId },
    ipAddress: ipFromReq(req),
    userAgent: uaFromReq(req),
  });

  res.status(204).end();
});

// ────────────────────────── Admin: active games ──────────────────────────

function isAdmin(req: Request): string | null {
  const userId = getAuthUserId(req);
  if (!userId || !env.ADMIN_USER_ID || userId !== env.ADMIN_USER_ID) return null;
  return userId;
}

router.get('/admin/games', async (req, res): Promise<void> => {
  const adminId = isAdmin(req);
  if (!adminId) {
    res.status(404).json({ error: 'NOT_FOUND' });
    return;
  }
  await audit({
    userId: adminId,
    action: 'admin.access',
    metadata: { endpoint: '/admin/games' },
    ipAddress: ipFromReq(req),
    userAgent: uaFromReq(req),
  });
  const rooms = await listAllRooms();
  const now = Date.now();
  const games = rooms.map((r) => {
    const firstMoveAt = r.moveLog[0]?.timestamp?.getTime() ?? null;
    const startedAt = firstMoveAt ?? (r.state ? r.createdAt : null);
    return {
      gameId: r.gameId,
      name: r.name,
      hostUsername: r.hostUsername,
      playerCount: r.playerCount,
      currentPlayers: r.players.length,
      status: r.state?.status ?? 'waiting',
      moveCount: r.moveLog.length,
      startedAt,
      elapsedMs: startedAt !== null ? now - startedAt : null,
    };
  });
  res.json({
    games,
    totalActive: games.filter((g) => g.status === 'active').length,
  });
});

// ────────────────────────── Admin: audit log ──────────────────────────

router.get('/admin/audit', async (req, res): Promise<void> => {
  const adminId = isAdmin(req);
  if (!adminId) {
    res.status(404).json({ error: 'NOT_FOUND' });
    return;
  }
  await audit({
    userId: adminId,
    action: 'admin.access',
    metadata: { endpoint: '/admin/audit' },
    ipAddress: ipFromReq(req),
    userAgent: uaFromReq(req),
  });
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 200));
  const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
  const entries = await prisma.auditLog.findMany({
    take: limit + 1,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    orderBy: { createdAt: 'desc' },
  });
  const hasMore = entries.length > limit;
  const page = hasMore ? entries.slice(0, limit) : entries;
  res.json({
    entries: page,
    nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
  });
});

// ────────────────────────── Admin: metrics ──────────────────────────

router.get('/admin/metrics', async (req, res): Promise<void> => {
  const adminId = isAdmin(req);
  if (!adminId) {
    res.status(404).json({ error: 'NOT_FOUND' });
    return;
  }
  await audit({
    userId: adminId,
    action: 'admin.access',
    metadata: { endpoint: '/admin/metrics' },
    ipAddress: ipFromReq(req),
    userAgent: uaFromReq(req),
  });
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [rooms, totalUsers, completedGamesToday, refreshTokens24h] = await Promise.all([
    listAllRooms(),
    prisma.user.count(),
    prisma.game.count({ where: { endedAt: { gte: startOfDay } } }),
    prisma.refreshToken.count({ where: { createdAt: { gte: dayAgo } } }),
  ]);
  res.json({
    activeRooms: rooms.length,
    totalUsers,
    completedGamesToday,
    refreshTokensIssued24h: refreshTokens24h,
  });
});

// ────────────────────────── Admin: debug throw ──────────────────────────

router.get('/debug/throw', (req, res, next): void => {
  const adminId = isAdmin(req);
  if (!adminId) {
    res.status(404).json({ error: 'NOT_FOUND' });
    return;
  }
  void audit({
    userId: adminId,
    action: 'admin.access',
    metadata: { endpoint: '/debug/throw' },
    ipAddress: ipFromReq(req),
    userAgent: uaFromReq(req),
  });
  next(new Error('debug/throw: forced exception for Sentry verification'));
});

// -----------------------------------------------------------------------------
// Google OAuth (direct OAuth2 flow, no Passport middleware required at runtime)
// -----------------------------------------------------------------------------

router.get('/auth/google/check', (_req, res): void => {
  res.json({ enabled: googleConfigured });
});

router.get('/auth/google', (_req, res): void => {
  if (!googleConfigured) {
    res.status(501).json({ code: 'OAUTH_DISABLED', error: 'Google sign-in is not configured.' });
    return;
  }
  const state = signToken(`oauth:${nanoid(12)}`, 5 * 60 * 1000);
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID!,
    redirect_uri: googleCallbackUrl(),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'online',
    prompt: 'select_account',
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

router.get('/auth/google/callback', async (req, res): Promise<void> => {
  if (!googleConfigured) {
    res.status(501).json({ code: 'OAUTH_DISABLED', error: 'Google sign-in is not configured.' });
    return;
  }
  const code = typeof req.query.code === 'string' ? req.query.code : null;
  const state = typeof req.query.state === 'string' ? req.query.state : null;
  if (!code || !state || !verifyToken(state)) {
    res.redirect(`${env.CLIENT_URL}/?oauth_error=invalid_state`);
    return;
  }
  try {
    const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID!,
        client_secret: env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: googleCallbackUrl(),
        grant_type: 'authorization_code',
      }).toString(),
    });
    if (!tokenResp.ok) {
      res.redirect(`${env.CLIENT_URL}/?oauth_error=token_exchange`);
      return;
    }
    const tokenData = (await tokenResp.json()) as { access_token?: string };
    if (!tokenData.access_token) {
      res.redirect(`${env.CLIENT_URL}/?oauth_error=no_token`);
      return;
    }
    const userResp = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    if (!userResp.ok) {
      res.redirect(`${env.CLIENT_URL}/?oauth_error=userinfo`);
      return;
    }
    const profile = (await userResp.json()) as {
      sub: string;
      email?: string;
      name?: string;
      picture?: string;
    };
    const user = await findOrCreateUserByGoogleId(profile.sub, {
      email: profile.email,
      displayName: profile.name,
      avatarUrl: profile.picture,
    });
    const accessToken = signToken(user.id);
    const refreshToken = await issueRefreshToken(user.id);
    setRefreshCookie(res, refreshToken);
    setCsrfCookie(res);
    await audit({
      userId: user.id,
      action: 'oauth.login',
      metadata: { provider: 'google' },
      ipAddress: ipFromReq(req),
      userAgent: uaFromReq(req),
    });
    const hash = new URLSearchParams({
      token: accessToken,
      refreshToken,
      userId: user.id,
      username: user.username,
    }).toString();
    res.redirect(`${env.CLIENT_URL}/lobby#${hash}`);
  } catch {
    res.redirect(`${env.CLIENT_URL}/?oauth_error=server`);
  }
});

// -----------------------------------------------------------------------------
// /me — profile fetch, patch, avatar upload presign
// -----------------------------------------------------------------------------

const PatchMeSchema = z.object({
  avatarUrl: z.string().url().max(2048).optional(),
  countryCode: z
    .string()
    .length(2)
    .regex(/^[A-Za-z]{2}$/)
    .transform((s) => s.toUpperCase())
    .nullable()
    .optional(),
});

const AvatarUploadUrlSchema = z.object({
  ext: z.string().min(1).max(8),
});

router.get('/me', async (req, res): Promise<void> => {
  const userId = getAuthUserId(req);
  if (!userId) {
    res.status(401).json({ error: 'INVALID_TOKEN' });
    return;
  }
  const me = await getProfile(userId);
  if (!me) {
    res.status(404).json({ error: 'NOT_FOUND' });
    return;
  }
  res.json(me);
});

router.patch('/me', async (req, res): Promise<void> => {
  const userId = getAuthUserId(req);
  if (!userId) {
    res.status(401).json({ error: 'INVALID_TOKEN' });
    return;
  }
  const parsed = PatchMeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const updated = await updateUserProfile(userId, parsed.data);
  res.json(updated);
});

router.post('/me/avatar/upload-url', async (req, res): Promise<void> => {
  const userId = getAuthUserId(req);
  if (!userId) {
    res.status(401).json({ error: 'INVALID_TOKEN' });
    return;
  }
  if (!s3Configured) {
    res.status(501).json({ code: 'S3_DISABLED', error: 'Avatar uploads are not configured.' });
    return;
  }
  const parsed = AvatarUploadUrlSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const presign = await getAvatarPresignedPutUrl(userId, parsed.data.ext);
    res.json(presign);
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});
