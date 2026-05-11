import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server as HttpServer } from 'node:http';
import express from 'express';
import { io as Client, type Socket as ClientSocket } from 'socket.io-client';
import { SOCKET_EVENTS, type GameOverEvent, type GameStartEvent } from '@cc/shared-types';
import { router } from '../routes.js';
import { attachSocket } from '../socket.js';
import { MOVE_LOG_CAP, _resetMoveRateLimit } from '../socket.js';
import { signToken } from '../auth.js';
import { createUserOrNull, findUserByName, getRoom, saveRoom } from '../store.js';

async function ensureUser(username: string) {
  const u = await findUserByName(username);
  if (u) return u;
  const created = await createUserOrNull(username, { isGuest: false });
  if (!created) throw new Error(`failed to create ${username}`);
  return created;
}

let httpServer: HttpServer;
let port: number;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', router);
  httpServer = createServer(app);
  attachSocket(httpServer);
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

function connectClient(token: string): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const sock = Client(`http://localhost:${port}/game`, {
      auth: { token },
      transports: ['websocket'],
      reconnection: false,
    });
    sock.on('connect', () => resolve(sock));
    sock.on('connect_error', reject);
  });
}

function once<T>(sock: ClientSocket, event: string, timeoutMs = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), timeoutMs);
    sock.once(event, (data: T) => {
      clearTimeout(t);
      resolve(data);
    });
  });
}

describe('moveLog cap → auto stalemate', () => {
  it('force-completes the game with endReason=stalemate once moveLog exceeds the cap', async () => {
    _resetMoveRateLimit();
    const mia = await ensureUser('mia_cap');
    const noa = await ensureUser('noa_cap');
    const miaTok = signToken(mia.id);
    const noaTok = signToken(noa.id);

    const created = await fetch(`http://localhost:${port}/api/v1/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'cap room',
        playerCount: 2,
        timer: 60,
        isPublic: true,
        allowSpectators: true,
        blockingRule: false,
        hostToken: miaTok,
      }),
    });
    const { gameId } = (await created.json()) as { gameId: string };

    const miaSock = await connectClient(miaTok);
    const noaSock = await connectClient(noaTok);

    const miaStart = once<GameStartEvent>(miaSock, SOCKET_EVENTS.GAME_START);
    const noaStart = once<GameStartEvent>(noaSock, SOCKET_EVENTS.GAME_START);
    miaSock.emit(SOCKET_EVENTS.ROOM_JOIN, { gameId, token: miaTok });
    noaSock.emit(SOCKET_EVENTS.ROOM_JOIN, { gameId, token: noaTok });
    const startEvt = await miaStart;
    await noaStart;

    // Backfill MOVE_LOG_CAP synthetic moves directly into the in-memory room
    // so we don't have to drive 10000 real socket round-trips.
    const room = await getRoom(gameId);
    expect(room).toBeTruthy();
    const now = new Date();
    for (let i = 1; i <= MOVE_LOG_CAP; i++) {
      room!.moveLog.push({
        moveNumber: i,
        userId: startEvt.currentTurn,
        fromQ: 0, fromR: 0, toQ: 0, toR: 0,
        path: [{ q: 0, r: 0 }, { q: 0, r: 0 }],
        isTimeout: false,
        timestamp: now,
      });
    }
    // Persist the synthetic backfill back to Redis — getRoom returns a
    // deserialized snapshot, so mutating the local copy alone has no effect.
    await saveRoom(room!);

    // Find a legal move for the current player to push past the cap.
    const cellMarble = startEvt.boardState.find(([k]) => k === '1,-5')?.[1] ?? null;
    expect(cellMarble).toBeTruthy();
    const moverUserId = cellMarble!.userId;
    expect(startEvt.currentTurn).toBe(moverUserId);
    const moverSock = moverUserId === mia.id ? miaSock : noaSock;

    const gameOver = once<GameOverEvent>(moverSock, SOCKET_EVENTS.GAME_OVER, 10_000);
    moverSock.emit(SOCKET_EVENTS.GAME_MOVE_ATTEMPT, {
      fromQ: 1, fromR: -5, toQ: 0, toR: -4,
    });
    const evt = await gameOver;
    expect(evt.endReason).toBe('stalemate');
    expect(Array.isArray(evt.finishOrder)).toBe(true);
    expect(evt.finishOrder.every((f) => f.eloDelta === 0)).toBe(true);

    miaSock.disconnect();
    noaSock.disconnect();
  }, 30_000);
});
