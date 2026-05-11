import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server as HttpServer } from 'node:http';
import { io as Client, type Socket as ClientSocket } from 'socket.io-client';
import { attachSocket, recheckSocketTokens } from '../socket.js';
import { signToken } from '../auth.js';
import { createUserOrNull, findUserByName } from '../store.js';
import type { Server as IOServer } from 'socket.io';

// Review fix: long-lived sockets must not outlive their JWT. recheckSocketTokens
// walks connected sockets, re-verifies the handshake token, and force-disconnects
// any whose token is no longer valid (here simulated with a backdated `exp`).

async function ensureUser(name: string) {
  const u = await findUserByName(name);
  if (u) return u;
  const created = await createUserOrNull(name, { isGuest: false });
  if (!created) throw new Error('create failed');
  return created;
}

let httpServer: HttpServer;
let io: IOServer;
let port: number;

beforeAll(async () => {
  httpServer = createServer();
  io = attachSocket(httpServer);
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

function waitForDisconnect(sock: ClientSocket, ms = 2000): Promise<string> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('no disconnect')), ms);
    sock.on('disconnect', (reason) => {
      clearTimeout(t);
      resolve(reason);
    });
  });
}

describe('recheckSocketTokens', () => {
  it('disconnects sockets whose handshake token has expired and leaves valid ones alone', async () => {
    const alice = await ensureUser(`alice_recheck_${Math.random().toString(36).slice(2, 6)}`);
    const bob = await ensureUser(`bob_recheck_${Math.random().toString(36).slice(2, 6)}`);

    const aliceShort = signToken(alice.id, 2_000); // ~2s, will be expired by recheck
    const bobLong = signToken(bob.id);

    const aliceSock: ClientSocket = await new Promise((resolve, reject) => {
      const s = Client(`http://localhost:${port}/game`, {
        auth: { token: aliceShort },
        transports: ['websocket'],
        reconnection: false,
      });
      s.on('connect', () => resolve(s));
      s.on('connect_error', reject);
    });
    const bobSock: ClientSocket = await new Promise((resolve, reject) => {
      const s = Client(`http://localhost:${port}/game`, {
        auth: { token: bobLong },
        transports: ['websocket'],
        reconnection: false,
      });
      s.on('connect', () => resolve(s));
      s.on('connect_error', reject);
    });

    // Wait past Alice's expiry, then trigger a recheck.
    await new Promise((r) => setTimeout(r, 2_500));
    const kicked = await recheckSocketTokens(io.of('/game'));
    expect(kicked).toBe(1);

    const reason = await waitForDisconnect(aliceSock);
    expect(reason).toBeTruthy();
    expect(bobSock.connected).toBe(true);

    bobSock.disconnect();
  }, 10_000);
});
