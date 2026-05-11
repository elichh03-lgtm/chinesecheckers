import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server as HttpServer } from 'node:http';
import express from 'express';
import { io as Client, type Socket as ClientSocket } from 'socket.io-client';
import { SOCKET_EVENTS } from '@cc/shared-types';
import type { GameMoveConfirmedEvent, GameStartEvent } from '@cc/shared-types';
import { router } from '../routes.js';
import { attachSocket } from '../socket.js';
import { signToken } from '../auth.js';
import { createUserOrNull, findUserByName } from '../store.js';
import { _resetMoveRateLimit } from '../socket.js';

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

function once<T>(sock: ClientSocket, event: string, timeoutMs = 2000): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), timeoutMs);
    sock.once(event, (data: T) => {
      clearTimeout(t);
      resolve(data);
    });
  });
}

describe('socket /game integration', () => {
  it('two players join a 2P room, game starts, a move is confirmed to both', async () => {
    const alice = await ensureUser('alice_int');
    const bob = await ensureUser('bob_int');
    const aliceTok = signToken(alice.id);
    const bobTok = signToken(bob.id);

    // Alice creates the room via REST
    const created = await fetch(`http://localhost:${port}/api/v1/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'integration room',
        playerCount: 2,
        timer: 60,
        isPublic: true,
        allowSpectators: true,
        blockingRule: false,
        hostToken: aliceTok,
      }),
    });
    const { gameId } = (await created.json()) as { gameId: string };
    expect(gameId).toBeTruthy();

    const aliceSock = await connectClient(aliceTok);
    const bobSock = await connectClient(bobTok);

    // Alice joins (host already in room.players from creation; Bob fills the slot)
    const aliceStart = once<GameStartEvent>(aliceSock, SOCKET_EVENTS.GAME_START);
    const bobStart = once<GameStartEvent>(bobSock, SOCKET_EVENTS.GAME_START);
    aliceSock.emit(SOCKET_EVENTS.ROOM_JOIN, { gameId, token: aliceTok });
    bobSock.emit(SOCKET_EVENTS.ROOM_JOIN, { gameId, token: bobTok });

    const startEvt = await aliceStart;
    await bobStart;
    expect(startEvt.gameId).toBe(gameId);
    expect(startEvt.turnOrder.length).toBe(2);

    // The first player in turn order moves a marble at (1,-5) → (0,-4) — a valid
    // single-step from player 0's home base when player 0 starts. The home point
    // depends on whose marble is at (1,-5) — verify and move appropriately.
    const cellMarble = startEvt.boardState.find(([k]) => k === '1,-5')?.[1] ?? null;
    expect(cellMarble).toBeTruthy();
    const moverUserId = cellMarble!.userId;
    const isAliceMover = moverUserId === alice.id;
    const moverSock = isAliceMover ? aliceSock : bobSock;
    const otherSock = isAliceMover ? bobSock : aliceSock;

    // Only proceed if mover is the current turn player; if not, the moves below
    // will be rejected (and the test would catch that). The first turn is index 0.
    expect(startEvt.currentTurn).toBe(moverUserId);

    const moverConfirmed = once<GameMoveConfirmedEvent>(moverSock, SOCKET_EVENTS.GAME_MOVE_CONFIRMED);
    const otherConfirmed = once<GameMoveConfirmedEvent>(otherSock, SOCKET_EVENTS.GAME_MOVE_CONFIRMED);

    moverSock.emit(SOCKET_EVENTS.GAME_MOVE_ATTEMPT, {
      fromQ: 1, fromR: -5, toQ: 0, toR: -4,
      // intentionally omit `path` — server should fill via engine
    });

    const moverEvt = await moverConfirmed;
    const otherEvt = await otherConfirmed;
    expect(moverEvt.fromQ).toBe(1);
    expect(moverEvt.toR).toBe(-4);
    expect(moverEvt.path.length).toBeGreaterThanOrEqual(2);
    expect(moverEvt.userId).toBe(moverUserId);
    expect(moverEvt.nextTurn).not.toBe(moverUserId);
    expect(otherEvt.fromQ).toBe(1); // both clients see the same move

    aliceSock.disconnect();
    bobSock.disconnect();
  });

  it('rejects moves when it is not your turn', async () => {
    const carol = await ensureUser('carol_int');
    const dave = await ensureUser('dave_int');
    const carolTok = signToken(carol.id);
    const daveTok = signToken(dave.id);

    const created = await fetch(`http://localhost:${port}/api/v1/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'turn enforcement room',
        playerCount: 2,
        timer: 60,
        isPublic: true,
        allowSpectators: true,
        blockingRule: false,
        hostToken: carolTok,
      }),
    });
    const { gameId } = (await created.json()) as { gameId: string };

    const carolSock = await connectClient(carolTok);
    const daveSock = await connectClient(daveTok);

    const carolStart = once<GameStartEvent>(carolSock, SOCKET_EVENTS.GAME_START);
    const daveStart = once<GameStartEvent>(daveSock, SOCKET_EVENTS.GAME_START);
    carolSock.emit(SOCKET_EVENTS.ROOM_JOIN, { gameId, token: carolTok });
    daveSock.emit(SOCKET_EVENTS.ROOM_JOIN, { gameId, token: daveTok });
    const startEvt = await carolStart;
    await daveStart;

    // Whoever ISN'T the current turn tries to move. Expect rejection.
    const notCurrent = startEvt.currentTurn === carol.id ? daveSock : carolSock;
    const rejection = once<{ reason: string }>(notCurrent, SOCKET_EVENTS.GAME_MOVE_REJECTED);
    notCurrent.emit(SOCKET_EVENTS.GAME_MOVE_ATTEMPT, {
      fromQ: 1, fromR: -5, toQ: 0, toR: -4,
    });
    const rej = await rejection;
    // Could be NOT_YOUR_TURN (if from has no marble owned by mover, NO_MARBLE/WRONG_OWNER also valid)
    expect(['NOT_YOUR_TURN', 'NO_MARBLE', 'WRONG_OWNER', 'INVALID_DESTINATION']).toContain(rej.reason);

    carolSock.disconnect();
    daveSock.disconnect();
  });

  it('rejects connections with a forged token', async () => {
    const forged = 'attacker_id.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    await expect(connectClient(forged)).rejects.toBeTruthy();
  });

  it('disconnects a socket that exceeds the move rate limit (30/min)', async () => {
    _resetMoveRateLimit();
    const eve = await ensureUser('eve_rate');
    const eveTok = signToken(eve.id);
    const sock = await connectClient(eveTok);

    const disconnected = new Promise<void>((resolve) => sock.once('disconnect', () => resolve()));

    // Fire 31 invalid moves — each consumes a token; the 31st should trigger disconnect.
    for (let i = 0; i < 31; i++) {
      sock.emit(SOCKET_EVENTS.GAME_MOVE_ATTEMPT, {
        fromQ: 0, fromR: 0, toQ: 1, toR: 0,
      });
    }
    await Promise.race([
      disconnected,
      new Promise((_r, rej) => setTimeout(() => rej(new Error('not disconnected')), 2000)),
    ]);
    expect(sock.connected).toBe(false);
  });
});
