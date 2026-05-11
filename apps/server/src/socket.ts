import type { Server as HttpServer } from 'node:http';
import { Server as IOServer, type Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import {
  applyMove,
  createInitialBoard,
  findPath,
  getAllValidMoves,
  getValidDestinations,
  parseKey,
  validateMove,
} from '@cc/game-engine';
import {
  SOCKET_EVENTS,
  type ChatMessage,
  type GameMoveConfirmedEvent,
  type GameOverEvent,
  type GameStartEvent,
  type GameValidDestinationsEvent,
  type RoomSummary,
} from '@cc/shared-types';
import { env } from './env.js';
import {
  appendMove,
  deleteRoom,
  getRoom,
  getUser,
  saveRoom,
  setRoomState,
  sweepIdleRooms,
  type Room,
} from './store.js';
import { redis } from './lib/redis.js';
import { verifyToken } from './auth.js';
import { persistCompletedGame } from './persistGame.js';

const COMPLETED_ROOM_TTL_MS = 60_000;
const IDLE_ROOM_TTL_MS = 30 * 60_000; // waiting rooms with no activity for 30 min
const IDLE_SWEEP_INTERVAL_MS = 60_000;
export const MOVE_LOG_CAP = 10_000;
export const SOCKET_TOKEN_RECHECK_INTERVAL_MS = 5 * 60_000;

const HexSchema = z.object({ q: z.number(), r: z.number() });
const RoomJoinSchema = z.object({
  gameId: z.string(),
  token: z.string(),
  asSpectator: z.boolean().optional(),
});
const MoveAttemptSchema = z.object({
  fromQ: z.number(),
  fromR: z.number(),
  toQ: z.number(),
  toR: z.number(),
  path: z.array(HexSchema).min(2).optional(),
});
const PreviewSchema = z.object({ fromQ: z.number(), fromR: z.number() });
const ChatSchema = z.object({
  content: z.string().min(1).max(200),
  type: z.enum(['text', 'emote']),
});

type AuthedSocket = Socket & {
  data: { userId: string; username: string; gameId?: string; isSpectator?: boolean };
};

const TURN_DEADLINES_KEY = 'turn:deadlines';
// Process-local cache of the next-fire setTimeout handle per game. Source of
// truth is the Redis sorted set `turn:deadlines` (score = timerEndsAt ms,
// member = gameId), so timers survive restart.
const turnTimerHandles = new Map<string, NodeJS.Timeout>();

// Per-user in-memory token bucket for GAME_MOVE_ATTEMPT (30/min).
const MOVE_RATE_WINDOW_MS = 60_000;
const MOVE_RATE_MAX = 30;
const moveBuckets = new Map<string, { count: number; resetAt: number }>();
export function consumeMoveToken(userId: string): boolean {
  const now = Date.now();
  const b = moveBuckets.get(userId);
  if (!b || b.resetAt <= now) {
    moveBuckets.set(userId, { count: 1, resetAt: now + MOVE_RATE_WINDOW_MS });
    return true;
  }
  if (b.count >= MOVE_RATE_MAX) return false;
  b.count += 1;
  return true;
}
export function _resetMoveRateLimit(): void {
  moveBuckets.clear();
}

export function attachSocket(httpServer: HttpServer): IOServer {
  const io = new IOServer(httpServer, {
    cors: { origin: env.CLIENT_URL, credentials: true },
  });

  // Redis pub/sub adapter — required for horizontal scale so events emitted on
  // one server replica reach sockets connected to another. Off by default
  // because a single-process server gets no benefit and pays an extra round-
  // trip on every fetchSockets()/broadcast. Enable with SOCKET_REDIS_ADAPTER=true
  // in multi-replica production deploys.
  if (env.SOCKET_REDIS_ADAPTER) {
    const pub = redis;
    const sub = redis.duplicate();
    io.adapter(createAdapter(pub, sub));
  }

  // Idle-room sweep — keeps the rooms map from growing unbounded when waiting
  // rooms are created and abandoned. (Active and completed rooms have their
  // own eviction paths.)
  if (env.NODE_ENV !== 'test') {
    setInterval(() => {
      void sweepIdleRooms(IDLE_ROOM_TTL_MS).then((evicted) => {
        if (evicted.length > 0) {
          // eslint-disable-next-line no-console
          console.log(`[idle-sweep] evicted ${evicted.length} stale waiting rooms`);
        }
      });
    }, IDLE_SWEEP_INTERVAL_MS).unref();
  }

  const game = io.of('/game');

  // Recover turn timers from Redis after restart. Wallclock-anchored deadlines
  // mean past entries fire immediately.
  if (env.NODE_ENV !== 'test') {
    void recoverTurnTimers(io).catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[turn-timer] recovery failed', err);
    });
  }

  game.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (typeof token !== 'string') return next(new Error('no token'));
    const userId = verifyToken(token);
    if (!userId) return next(new Error('bad token'));
    const u = await getUser(userId);
    if (!u) return next(new Error('unknown user'));
    (socket as AuthedSocket).data = { userId: u.id, username: u.username };
    next();
  });

  // Review fix: JWT access tokens are short-lived but a socket connection can
  // outlive its issuing token. Re-verify every 5 min and disconnect any socket
  // whose handshake token has since expired or been revoked.
  if (env.NODE_ENV !== 'test') {
    setInterval(() => {
      void recheckSocketTokens(game);
    }, SOCKET_TOKEN_RECHECK_INTERVAL_MS).unref();
  }

  game.on('connection', (socket: Socket) => {
    const s = socket as AuthedSocket;

    s.on(SOCKET_EVENTS.ROOM_JOIN, async (raw, ack?: (res: unknown) => void) => {
      const parsed = RoomJoinSchema.safeParse(raw);
      if (!parsed.success) return ack?.({ error: 'INVALID_PAYLOAD' });
      const room = await getRoom(parsed.data.gameId);
      if (!room) return ack?.({ error: 'NOT_FOUND' });

      if (!room.state && !parsed.data.asSpectator) {
        const already = room.players.some((p) => p.userId === s.data.userId);
        if (!already && room.players.length < room.playerCount) {
          room.players.push({
            userId: s.data.userId,
            username: s.data.username,
            ready: false,
          });
          await saveRoom(room);
        }
      }

      s.data.gameId = room.gameId;
      s.data.isSpectator = !room.players.some((p) => p.userId === s.data.userId);
      s.join(room.gameId);

      // Broadcast to everyone in the room so existing players see joiner counts.
      emitRoomState(io, room);

      if (!room.state && room.players.length === room.playerCount) {
        await startGame(io, room);
      } else if (!room.state) {
        // Notify host that they can start now if a valid count is reached.
        emitRoomState(io, room);
      } else if (room.state && room.state.status === 'active') {
        emitGameStart(s, room, true);
      }

      ack?.({ ok: true });
    });

    s.on(SOCKET_EVENTS.GAME_START_REQUEST, async () => {
      const room = await currentRoom(s);
      if (!room) return;
      if (room.state) return; // already started
      if (room.hostUserId !== s.data.userId) {
        s.emit(SOCKET_EVENTS.ERROR, {
          code: 'NOT_HOST',
          message: 'only the host can start',
        });
        return;
      }
      const count = room.players.length;
      if (count !== 2 && count !== 3 && count !== 4 && count !== 6) {
        s.emit(SOCKET_EVENTS.ERROR, {
          code: 'INVALID_PLAYER_COUNT',
          message: 'need 2, 3, 4, or 6 players to start',
        });
        return;
      }
      // Honor the player-count actually present (so a 4P room with 3 joiners
      // starts as a 3P game).
      room.playerCount = count;
      await saveRoom(room);
      await startGame(io, room);
    });

    s.on(SOCKET_EVENTS.GAME_REQUEST_PREVIEW, async (raw) => {
      const parsed = PreviewSchema.safeParse(raw);
      if (!parsed.success) return;
      if (s.data.isSpectator) return;
      const room = await currentRoom(s);
      if (!room?.state) return;
      const dests = getValidDestinations(
        room.state,
        { q: parsed.data.fromQ, r: parsed.data.fromR },
        s.data.userId,
      );
      const evt: GameValidDestinationsEvent = {
        destinations: Array.from(dests).map(parseKey),
      };
      s.emit(SOCKET_EVENTS.GAME_VALID_DESTINATIONS, evt);
    });

    s.on(SOCKET_EVENTS.GAME_MOVE_ATTEMPT, async (raw): Promise<void> => {
      const parsed = MoveAttemptSchema.safeParse(raw);
      if (!parsed.success) {
        // eslint-disable-next-line no-console
        console.warn('[invalid-payload] game:move_attempt', JSON.stringify(parsed.error.flatten()));
        s.emit(SOCKET_EVENTS.ERROR, { code: 'INVALID_PAYLOAD' });
        return;
      }
      if (!consumeMoveToken(s.data.userId)) {
        s.emit(SOCKET_EVENTS.ERROR, { code: 'RATE_LIMITED' });
        s.disconnect(true);
        return;
      }
      if (s.data.isSpectator) {
        s.emit(SOCKET_EVENTS.GAME_MOVE_REJECTED, { reason: 'NOT_YOUR_TURN' });
        return;
      }
      const room = await currentRoom(s);
      if (!room?.state) {
        s.emit(SOCKET_EVENTS.GAME_MOVE_REJECTED, { reason: 'GAME_NOT_ACTIVE' });
        return;
      }
      const from = { q: parsed.data.fromQ, r: parsed.data.fromR };
      const to = { q: parsed.data.toQ, r: parsed.data.toR };
      const path = parsed.data.path ?? findPath(room.state, from, to);
      if (!path) {
        s.emit(SOCKET_EVENTS.GAME_MOVE_REJECTED, { reason: 'INVALID_DESTINATION' });
        return;
      }
      const moveWithPath = { ...parsed.data, path };
      const result = validateMove(room.state, s.data.userId, moveWithPath);
      if (!result.valid) {
        s.emit(SOCKET_EVENTS.GAME_MOVE_REJECTED, { reason: result.reason });
        return;
      }
      const movedUserId = room.state.turnOrder[room.state.currentTurnIndex]!;
      const next = applyMove(room.state, moveWithPath);
      next.timerEndsAt = Date.now() + room.timer * 1000;
      await setRoomState(room.gameId, next);
      await appendMove(room.gameId, {
        moveNumber: room.moveLog.length + 1,
        userId: movedUserId,
        fromQ: parsed.data.fromQ,
        fromR: parsed.data.fromR,
        toQ: parsed.data.toQ,
        toR: parsed.data.toR,
        path,
        isTimeout: false,
        timestamp: new Date(),
      });
      // Refresh local snapshot so downstream branches (stalemate check, emitGameOver) see the appended move.
      const refreshed = await getRoom(room.gameId);
      if (refreshed) room.moveLog = refreshed.moveLog;
      scheduleTurnTimer(io, refreshed ?? room);

      if (room.moveLog.length > MOVE_LOG_CAP && next.status !== 'completed') {
        const stalemated = { ...next, status: 'completed' as const, endReason: 'stalemate' as const };
        await setRoomState(room.gameId, stalemated);
        const confirmedEvent: GameMoveConfirmedEvent = {
          moveId: nanoid(8),
          userId: movedUserId,
          fromQ: parsed.data.fromQ,
          fromR: parsed.data.fromR,
          toQ: parsed.data.toQ,
          toR: parsed.data.toR,
          path,
          nextTurn: stalemated.turnOrder[stalemated.currentTurnIndex]!,
          timerEndsAt: stalemated.timerEndsAt,
        };
        game.to(room.gameId).emit(SOCKET_EVENTS.GAME_MOVE_CONFIRMED, confirmedEvent);
        void emitGameOver(game, room, stalemated);
        return;
      }

      const confirmedEvent: GameMoveConfirmedEvent = {
        moveId: nanoid(8),
        userId: movedUserId,
        fromQ: parsed.data.fromQ,
        fromR: parsed.data.fromR,
        toQ: parsed.data.toQ,
        toR: parsed.data.toR,
        path,
        nextTurn: next.turnOrder[next.currentTurnIndex]!,
        timerEndsAt: next.timerEndsAt,
      };
      game.to(room.gameId).emit(SOCKET_EVENTS.GAME_MOVE_CONFIRMED, confirmedEvent);

      if (next.status === 'completed') {
        void emitGameOver(game, room, next);
      }
    });

    s.on(SOCKET_EVENTS.CHAT_SEND, async (raw) => {
      const parsed = ChatSchema.safeParse(raw);
      if (!parsed.success) return;
      const room = await currentRoom(s);
      if (!room) return;
      const msg: ChatMessage = {
        id: nanoid(8),
        userId: s.data.userId,
        username: s.data.username,
        isSpectator: !!s.data.isSpectator,
        type: parsed.data.type,
        content: parsed.data.content,
        sentAt: Date.now(),
      };
      game.to(room.gameId).emit(SOCKET_EVENTS.CHAT_MESSAGE, msg);
    });

    s.on(SOCKET_EVENTS.GAME_RESIGN, async () => {
      if (s.data.isSpectator) return;
      const room = await currentRoom(s);
      if (!room?.state) return;
      if (room.state.finishedPlayers.some((p) => p.userId === s.data.userId)) return;
      const next = {
        ...room.state,
        finishedPlayers: [
          ...room.state.finishedPlayers,
          { userId: s.data.userId, finishPos: room.state.turnOrder.length },
        ],
      };
      if (next.finishedPlayers.length >= next.turnOrder.length - 1) {
        next.status = 'completed';
        next.endReason = 'resign';
        await setRoomState(room.gameId, next);
        void emitGameOver(game, room, next);
      } else {
        await setRoomState(room.gameId, next);
      }
    });

    s.on('disconnect', () => {
      // Server keeps room state to allow reconnection. Eviction triggers
      // either on game-completion TTL or future idle-timeout sweep.
    });
  });

  return io;
}

export async function recheckSocketTokens(
  game: ReturnType<IOServer['of']>,
): Promise<number> {
  const sockets = await game.fetchSockets();
  let kicked = 0;
  for (const sock of sockets) {
    const token = (sock.handshake as { auth?: { token?: unknown } }).auth?.token;
    const ok = typeof token === 'string' && verifyToken(token);
    if (!ok) {
      sock.emit(SOCKET_EVENTS.ERROR, { code: 'TOKEN_EXPIRED', message: 'token_expired' });
      sock.disconnect(true);
      kicked += 1;
    }
  }
  return kicked;
}

async function currentRoom(s: AuthedSocket): Promise<Room | undefined> {
  const id = s.data.gameId;
  if (!id) return undefined;
  return getRoom(id);
}

function emitRoomState(io: IOServer, room: Room): void {
  const payload = summarizeRoom(room, false);
  io.of('/game').to(room.gameId).emit('room:state', payload);
}

function summarizeRoom(room: Room, _isSpectator: boolean) {
  const summary: RoomSummary & { hostUserId: string } = {
    gameId: room.gameId,
    name: room.name,
    hostUsername: room.hostUsername,
    playerCount: room.playerCount,
    currentPlayers: room.players.length,
    timer: room.timer,
    isPublic: room.isPublic,
    allowSpectators: room.allowSpectators,
    status: room.state?.status ?? 'waiting',
    hostUserId: room.hostUserId,
  };
  // Recipients infer their own spectator role from `players`.
  return { ...summary, players: room.players };
}

async function startGame(io: IOServer, room: Room): Promise<void> {
  const ids = room.players.map((p) => p.userId);
  const initial = createInitialBoard(room.playerCount, ids, {
    blockingRule: room.blockingRule,
  });
  initial.gameId = room.gameId;
  initial.status = 'active';
  initial.timerEndsAt = Date.now() + room.timer * 1000;
  await setRoomState(room.gameId, initial);
  // Local snapshot tracks the freshly-written state for downstream emitters.
  room.state = initial;
  scheduleTurnTimer(io, room);

  const sockets = await io.of('/game').in(room.gameId).fetchSockets();
  for (const sock of sockets) emitGameStart(sock as unknown as AuthedSocket, room, false);
}

function emitGameStart(socket: AuthedSocket | Socket, room: Room, isReconnect: boolean): void {
  if (!room.state) return;
  const evt: GameStartEvent = {
    gameId: room.gameId,
    boardState: Array.from(room.state.board.entries()),
    turnOrder: room.state.turnOrder,
    currentTurn: room.state.turnOrder[room.state.currentTurnIndex]!,
    timerEndsAt: room.state.timerEndsAt,
    playerCount: room.playerCount,
    playerColors: room.state.playerColors,
    playerHomePoint: room.state.playerHomePoint,
    blockingRule: room.state.blockingRule,
    isReconnect,
  };
  socket.emit(SOCKET_EVENTS.GAME_START, evt);
}

async function emitGameOver(
  game: ReturnType<IOServer['of']>,
  room: Room,
  fullState: import('@cc/shared-types').GameState,
): Promise<void> {
  // Persist + compute ELO atomically. If persistence fails, fall back to a
  // zero-delta payload so clients still see the game-over event.
  const gameId = room.gameId;
  let finishOrder: GameOverEvent['finishOrder'];
  try {
    finishOrder = await persistCompletedGame({
      gameId,
      state: fullState,
      blockingRule: room.blockingRule,
      moveLog: room.moveLog,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('persistCompletedGame failed', err);
    const finishedIds = new Set(fullState.finishedPlayers.map((p) => p.userId));
    const trailing = fullState.turnOrder.filter((id) => !finishedIds.has(id));
    finishOrder = [
      ...fullState.finishedPlayers.map((p) => ({ ...p, eloDelta: 0 })),
      ...trailing.map((id, i) => ({
        userId: id,
        finishPos: fullState.finishedPlayers.length + 1 + i,
        eloDelta: 0,
      })),
    ];
  }
  game.to(gameId).emit(SOCKET_EVENTS.GAME_OVER, {
    finishOrder,
    endReason: fullState.endReason ?? 'win',
  } satisfies GameOverEvent);
  clearTurnTimer(gameId);
  scheduleRoomEviction(gameId);
}

/**
 * Schedule a single setTimeout for the current turn's deadline. On fire we
 * re-check the wall clock — if the system slept past the deadline, we run
 * the timeout immediately; if we fired early (rare with setTimeout but cheap
 * to guard), we reschedule for the residual time. This is the wallclock-
 * resilient flavor of the classic setTimeout-only pattern (CLAUDE.md forbids
 * setInterval).
 */
function scheduleTurnTimer(io: IOServer, room: Room): void {
  const gameId = room.gameId;
  const handleExisting = turnTimerHandles.get(gameId);
  if (handleExisting) clearTimeout(handleExisting);

  const endsAt = room.state?.timerEndsAt ?? Date.now() + room.timer * 1000;
  void redis.zadd(TURN_DEADLINES_KEY, endsAt, gameId).catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[turn-timer] zadd failed', err);
  });

  const tick = async (): Promise<void> => {
    const r = await getRoom(gameId);
    if (!r?.state || r.state.status !== 'active') {
      await redis.zrem(TURN_DEADLINES_KEY, gameId);
      return;
    }
    const remaining = r.state.timerEndsAt - Date.now();
    if (remaining > 50) {
      // Spurious early fire — reschedule.
      const handle = setTimeout(tick, remaining);
      turnTimerHandles.set(gameId, handle);
      return;
    }
    await onTimeout(io, gameId);
  };
  const initialDelay = Math.max(0, endsAt - Date.now());
  const handle = setTimeout(tick, initialDelay);
  turnTimerHandles.set(gameId, handle);
}

function clearTurnTimer(gameId: string): void {
  const t = turnTimerHandles.get(gameId);
  if (t) clearTimeout(t);
  turnTimerHandles.delete(gameId);
  void redis.zrem(TURN_DEADLINES_KEY, gameId).catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[turn-timer] zrem failed', err);
  });
}

/**
 * Re-arm turn timers from Redis on server boot. Each entry's deadline is
 * already wallclock-anchored, so a past deadline fires `onTimeout` immediately.
 */
async function recoverTurnTimers(io: IOServer): Promise<void> {
  const entries = await redis.zrange(TURN_DEADLINES_KEY, 0, -1, 'WITHSCORES');
  for (let i = 0; i < entries.length; i += 2) {
    const gameId = entries[i]!;
    const room = await getRoom(gameId);
    if (!room?.state || room.state.status !== 'active') {
      await redis.zrem(TURN_DEADLINES_KEY, gameId);
      continue;
    }
    scheduleTurnTimer(io, room);
  }
}

async function onTimeout(io: IOServer, gameId: string): Promise<void> {
  const room = await getRoom(gameId);
  if (!room?.state || room.state.status !== 'active') return;
  const game = io.of('/game');
  const currentPlayer = room.state.turnOrder[room.state.currentTurnIndex]!;
  const moves = getAllValidMoves(room.state, currentPlayer);
  if (moves.length === 0) return;
  const move = moves[Math.floor(Math.random() * moves.length)]!;
  const next = applyMove(room.state, move);
  next.timerEndsAt = Date.now() + room.timer * 1000;
  next.timeoutStrikes[currentPlayer] = (next.timeoutStrikes[currentPlayer] ?? 0) + 1;
  await setRoomState(gameId, next);
  await appendMove(gameId, {
    moveNumber: room.moveLog.length + 1,
    userId: currentPlayer,
    fromQ: move.fromQ,
    fromR: move.fromR,
    toQ: move.toQ,
    toR: move.toR,
    path: move.path,
    isTimeout: true,
    timestamp: new Date(),
  });
  const refreshed = await getRoom(gameId);
  if (refreshed) room.moveLog = refreshed.moveLog;

  const confirmedEvent: GameMoveConfirmedEvent = {
    moveId: nanoid(8),
    userId: currentPlayer,
    fromQ: move.fromQ,
    fromR: move.fromR,
    toQ: move.toQ,
    toR: move.toR,
    path: move.path,
    nextTurn: next.turnOrder[next.currentTurnIndex]!,
    timerEndsAt: next.timerEndsAt,
  };
  game.to(gameId).emit(SOCKET_EVENTS.GAME_MOVE_CONFIRMED, confirmedEvent);

  if (room.moveLog.length > MOVE_LOG_CAP && next.status !== 'completed') {
    const stalemated = { ...next, status: 'completed' as const, endReason: 'stalemate' as const };
    await setRoomState(gameId, stalemated);
    void emitGameOver(game, room, stalemated);
    return;
  }

  if (next.status === 'completed') {
    void emitGameOver(game, room, next);
  } else {
    scheduleTurnTimer(io, room);
  }
}

function scheduleRoomEviction(gameId: string): void {
  setTimeout(() => {
    void deleteRoom(gameId);
  }, COMPLETED_ROOM_TTL_MS);
}
