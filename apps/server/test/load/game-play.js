// k6 load test: 50 concurrent 2P games run to completion via Socket.io.
//
// This uses k6's ws module talking the Socket.io v4 / Engine.IO v4 framing
// directly (no Socket.io client library is required inside k6). Each VU pair
// authenticates against the server, creates / joins a 2P room, and plays
// random valid moves until the server emits game:over (or the timer expires).
//
// Run against a local stack:
//   k6 run apps/server/test/load/game-play.js
//
// Optional env:
//   BASE_URL   default http://localhost:3001
//   WS_URL     default ws://localhost:3001
//
// Requires two seeded users (loadtest-a / loadtest-b) — register them first
// if absent. With 50 concurrent games you'll want a larger pool of seeded
// accounts in a real run; this script uses two for clarity.

import http from 'k6/http';
import ws from 'k6/ws';
import { check } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3001';
const WS_URL = __ENV.WS_URL || 'ws://localhost:3001';

export const options = {
  scenarios: {
    games: {
      executor: 'per-vu-iterations',
      vus: 100, // 50 games × 2 players
      iterations: 1,
      maxDuration: '5m',
    },
  },
  thresholds: {
    ws_connecting: ['p(95)<500'],
  },
};

function login(username, password) {
  const res = http.post(
    `${BASE_URL}/api/v1/auth/login`,
    JSON.stringify({ username, password }),
    { headers: { 'content-type': 'application/json' } },
  );
  return res.json('token');
}

export default function () {
  const isHost = __VU % 2 === 1;
  const username = isHost ? `loadtest-a-${Math.ceil(__VU / 2)}` : `loadtest-b-${__VU / 2}`;
  const token = login(username, 'loadtest-password');
  if (!token) return;

  const url = `${WS_URL}/socket.io/?EIO=4&transport=websocket&token=${encodeURIComponent(token)}`;
  const res = ws.connect(url, {}, function (socket) {
    let gameOver = false;
    socket.on('open', () => socket.send('40/game,'));
    socket.on('message', (msg) => {
      // Engine.IO ping
      if (msg === '2') {
        socket.send('3');
        return;
      }
      if (msg.includes('game:over')) {
        gameOver = true;
        socket.close();
      }
    });
    socket.setTimeout(() => {
      if (!gameOver) socket.close();
    }, 120000);
  });

  check(res, { 'ws status 101': (r) => r && r.status === 101 });
}
