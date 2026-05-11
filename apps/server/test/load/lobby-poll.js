// k6 load test: lobby polling — 100 clients poll /rooms every 2s for 60s.
//
// Run against a local stack:
//   k6 run apps/server/test/load/lobby-poll.js
//
// Optional env:
//   BASE_URL   default http://localhost:3001

import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  scenarios: {
    poll: {
      executor: 'constant-vus',
      vus: 100,
      duration: '60s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<200'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3001';

export default function () {
  const res = http.get(`${BASE_URL}/api/v1/rooms`);
  check(res, {
    'status is 200': (r) => r.status === 200,
    'has rooms array': (r) => Array.isArray(r.json('rooms')),
  });
  sleep(2);
}
