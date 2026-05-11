import { nanoid } from 'nanoid';
import type {
  GameState,
  PlayerCount,
  RoomSummary,
} from '@cc/shared-types';
import { prisma } from './lib/prisma.js';
import { redis } from './lib/redis.js';
import { isReservedUsername } from './reservedUsernames.js';

/**
 * Store boundary. User identity lives in Postgres (Prisma). Active rooms
 * (waiting + in-progress + briefly-after-completion) live in Redis under:
 *
 *   room:{gameId}            JSON snapshot — metadata + state + moveLog
 *   rooms:public             SET of public gameIds (status != completed)
 *   rooms:waiting            ZSET, score = createdAt, member = gameId
 *
 * `state.board` is a Map<string, Marble|null> in memory but is serialized as
 * an array of entries for JSON. Move log timestamps round-trip through ISO
 * strings and are re-hydrated to Date so persistGame stays unchanged.
 */

export type Room = {
  gameId: string;
  name: string;
  hostUserId: string;
  hostUsername: string;
  playerCount: PlayerCount;
  timer: number;
  isPublic: boolean;
  allowSpectators: boolean;
  blockingRule: boolean;
  players: Array<{ userId: string; username: string; ready: boolean }>;
  createdAt: number;
  state: GameState | null;
  moveLog: Array<{
    moveNumber: number;
    userId: string;
    fromQ: number;
    fromR: number;
    toQ: number;
    toR: number;
    path: Array<{ q: number; r: number }>;
    isTimeout: boolean;
    timestamp: Date;
  }>;
};

export type User = {
  id: string;
  username: string;
};

const ROOM_KEY = (gameId: string): string => `room:${gameId}`;
const ROOMS_PUBLIC = 'rooms:public';
const ROOMS_WAITING = 'rooms:waiting';

function serializeRoom(room: Room): string {
  return JSON.stringify({
    ...room,
    state: room.state
      ? { ...room.state, board: Array.from(room.state.board.entries()) }
      : null,
    moveLog: room.moveLog.map((m) => ({ ...m, timestamp: m.timestamp.toISOString() })),
  });
}

function deserializeRoom(json: string): Room {
  const raw = JSON.parse(json) as Omit<Room, 'state' | 'moveLog'> & {
    state: (Omit<GameState, 'board'> & { board: Array<[string, unknown]> }) | null;
    moveLog: Array<Omit<Room['moveLog'][number], 'timestamp'> & { timestamp: string }>;
  };
  return {
    ...raw,
    state: raw.state
      ? ({ ...raw.state, board: new Map(raw.state.board) } as GameState)
      : null,
    moveLog: raw.moveLog.map((m) => ({ ...m, timestamp: new Date(m.timestamp) })),
  };
}

// ────────────────────────── Users (Prisma) ──────────────────────────

export async function createUserOrNull(
  username: string,
  opts: { isGuest?: boolean; email?: string | null } = {},
): Promise<User | null> {
  if (isReservedUsername(username)) return null;
  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) return null;
  if (opts.email) {
    const byEmail = await prisma.user.findUnique({ where: { email: opts.email } });
    if (byEmail) return null;
  }
  const u = await prisma.user.create({
    data: { username, isGuest: opts.isGuest ?? true, email: opts.email ?? null },
    select: { id: true, username: true },
  });
  return u;
}

export async function findUserByName(
  username: string,
  opts: { withPasswordHash?: boolean } = {},
): Promise<(User & { passwordHash?: string | null }) | undefined> {
  const u = await prisma.user.findUnique({
    where: { username },
    select: {
      id: true,
      username: true,
      passwordHash: opts.withPasswordHash ?? false,
    },
  });
  return u ?? undefined;
}

export async function getUser(id: string): Promise<User | undefined> {
  const u = await prisma.user.findUnique({
    where: { id },
    select: { id: true, username: true },
  });
  return u ?? undefined;
}

export async function setUserPassword(userId: string, passwordHash: string): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
}

export type ProfileUser = {
  id: string;
  username: string;
  email: string | null;
  avatarUrl: string | null;
  countryCode: string | null;
};

const PROFILE_SELECT = {
  id: true,
  username: true,
  email: true,
  avatarUrl: true,
  countryCode: true,
} as const;

export async function getProfile(userId: string): Promise<ProfileUser | undefined> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: PROFILE_SELECT });
  return u ?? undefined;
}

export async function updateUserProfile(
  userId: string,
  patch: { avatarUrl?: string; countryCode?: string | null },
): Promise<ProfileUser> {
  const data: { avatarUrl?: string; countryCode?: string | null } = {};
  if (patch.avatarUrl !== undefined) data.avatarUrl = patch.avatarUrl;
  if (patch.countryCode !== undefined) data.countryCode = patch.countryCode;
  return prisma.user.update({ where: { id: userId }, data, select: PROFILE_SELECT });
}

export async function findOrCreateUserByGoogleId(
  googleId: string,
  profile: { email?: string | null; displayName?: string | null; avatarUrl?: string | null } = {},
): Promise<User> {
  const byGoogle = await prisma.user.findUnique({ where: { googleId } });
  if (byGoogle) return { id: byGoogle.id, username: byGoogle.username };

  if (profile.email) {
    const byEmail = await prisma.user.findUnique({ where: { email: profile.email } });
    if (byEmail) {
      const updated = await prisma.user.update({
        where: { id: byEmail.id },
        data: {
          googleId,
          ...(byEmail.avatarUrl ? {} : profile.avatarUrl ? { avatarUrl: profile.avatarUrl } : {}),
        },
        select: { id: true, username: true },
      });
      return updated;
    }
  }

  const base = slugifyUsername(profile.displayName ?? profile.email ?? 'user');
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = attempt === 0 ? base : `${base}_${nanoid(4).toLowerCase()}`;
    if (isReservedUsername(candidate)) continue;
    const taken = await prisma.user.findUnique({ where: { username: candidate } });
    if (taken) continue;
    return prisma.user.create({
      data: {
        username: candidate,
        email: profile.email ?? null,
        googleId,
        avatarUrl: profile.avatarUrl ?? null,
        isGuest: false,
      },
      select: { id: true, username: true },
    });
  }
  const fallback = `${base}_${nanoid(8).toLowerCase()}`;
  return prisma.user.create({
    data: {
      username: fallback,
      email: profile.email ?? null,
      googleId,
      avatarUrl: profile.avatarUrl ?? null,
      isGuest: false,
    },
    select: { id: true, username: true },
  });
}

function slugifyUsername(raw: string): string {
  const cleaned = raw
    .normalize('NFKD')
    .replace(/[^\w]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 16);
  if (cleaned.length >= 2) return cleaned;
  return `user_${nanoid(6).toLowerCase()}`;
}

// ────────────────────────── Rooms (Redis) ──────────────────────────

export async function createRoom(opts: {
  name: string;
  host: User;
  playerCount: PlayerCount;
  timer: number;
  isPublic: boolean;
  allowSpectators: boolean;
  blockingRule: boolean;
}): Promise<Room> {
  const room: Room = {
    gameId: nanoid(8),
    name: opts.name,
    hostUserId: opts.host.id,
    hostUsername: opts.host.username,
    playerCount: opts.playerCount,
    timer: opts.timer,
    isPublic: opts.isPublic,
    allowSpectators: opts.allowSpectators,
    blockingRule: opts.blockingRule,
    players: [{ userId: opts.host.id, username: opts.host.username, ready: false }],
    createdAt: Date.now(),
    state: null,
    moveLog: [],
  };
  const tx = redis.multi().set(ROOM_KEY(room.gameId), serializeRoom(room));
  if (room.isPublic) tx.sadd(ROOMS_PUBLIC, room.gameId);
  tx.zadd(ROOMS_WAITING, room.createdAt, room.gameId);
  await tx.exec();
  return room;
}

export async function getRoom(gameId: string): Promise<Room | undefined> {
  const json = await redis.get(ROOM_KEY(gameId));
  if (!json) return undefined;
  return deserializeRoom(json);
}

/**
 * Persist a Room snapshot. Updates derived indexes (`rooms:public`,
 * `rooms:waiting`) to reflect the current state status.
 */
export async function saveRoom(room: Room): Promise<void> {
  const tx = redis.multi().set(ROOM_KEY(room.gameId), serializeRoom(room));
  if (room.isPublic && (room.state?.status ?? 'waiting') !== 'completed') {
    tx.sadd(ROOMS_PUBLIC, room.gameId);
  } else {
    tx.srem(ROOMS_PUBLIC, room.gameId);
  }
  if (room.state) {
    tx.zrem(ROOMS_WAITING, room.gameId);
  } else {
    tx.zadd(ROOMS_WAITING, room.createdAt, room.gameId);
  }
  await tx.exec();
}

export async function listPublicRooms(): Promise<RoomSummary[]> {
  const ids = await redis.smembers(ROOMS_PUBLIC);
  if (ids.length === 0) return [];
  const keys = ids.map(ROOM_KEY);
  const blobs = await redis.mget(...keys);
  const out: RoomSummary[] = [];
  for (let i = 0; i < blobs.length; i++) {
    const blob = blobs[i];
    if (!blob) {
      // Stale index entry — clean up.
      await redis.srem(ROOMS_PUBLIC, ids[i]!);
      continue;
    }
    const r = deserializeRoom(blob);
    if (!r.isPublic || (r.state?.status ?? 'waiting') === 'completed') continue;
    out.push({
      gameId: r.gameId,
      name: r.name,
      hostUsername: r.hostUsername,
      playerCount: r.playerCount,
      currentPlayers: r.players.length,
      timer: r.timer,
      isPublic: r.isPublic,
      allowSpectators: r.allowSpectators,
      status: r.state?.status ?? 'waiting',
    });
  }
  return out;
}

export async function deleteRoom(gameId: string): Promise<void> {
  await redis
    .multi()
    .del(ROOM_KEY(gameId))
    .srem(ROOMS_PUBLIC, gameId)
    .zrem(ROOMS_WAITING, gameId)
    .exec();
}

export async function listAllRooms(): Promise<Room[]> {
  // Admin endpoint — scan over `room:*`. Acceptable; not a hot path.
  const out: Room[] = [];
  let cursor = '0';
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', 'room:*', 'COUNT', 100);
    cursor = next;
    if (keys.length > 0) {
      const blobs = await redis.mget(...keys);
      for (const blob of blobs) {
        if (blob) out.push(deserializeRoom(blob));
      }
    }
  } while (cursor !== '0');
  return out;
}

export async function setRoomState(gameId: string, state: GameState): Promise<void> {
  const room = await getRoom(gameId);
  if (!room) return;
  room.state = state;
  await saveRoom(room);
}

export async function appendMove(
  gameId: string,
  entry: Room['moveLog'][number],
): Promise<void> {
  const room = await getRoom(gameId);
  if (!room) return;
  room.moveLog.push(entry);
  await saveRoom(room);
}

/**
 * Sweep waiting rooms older than `maxAgeMs` with no active game. Uses the
 * `rooms:waiting` sorted-set index (score = createdAt). Returns evicted IDs.
 */
export async function sweepIdleRooms(maxAgeMs: number): Promise<string[]> {
  const cutoff = Date.now() - maxAgeMs;
  const stale = await redis.zrangebyscore(ROOMS_WAITING, 0, cutoff);
  const evicted: string[] = [];
  for (const id of stale) {
    const room = await getRoom(id);
    if (!room) {
      await redis.zrem(ROOMS_WAITING, id);
      continue;
    }
    if (room.state) {
      // Became active after indexing; remove from waiting set.
      await redis.zrem(ROOMS_WAITING, id);
      continue;
    }
    await deleteRoom(id);
    evicted.push(id);
  }
  return evicted;
}
