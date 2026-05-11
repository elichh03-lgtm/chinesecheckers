// k6 load test: login storm — 50 concurrent /auth/login requests.
//
// Run against a local stack:
//   k6 run apps/server/test/load/login-storm.js
//
// Optional env:
//   BASE_URL   default http://localhost:3001
//   USERNAME   default loadtest
//   PASSWORD   default loadtest-password
//
// The seeded user must exist; create one via the register endpoint first if
// needed:
//   curl -X POST $BASE_URL/api/v1/auth/register \
//        -H 'content-type: application/json' \
//        -d '{"username":"loadtest","password":"loadtest-password"}'

import http from 'k6/http';
import { check } from 'k6';

export const options = {
  scenarios: {
    storm: {
      executor: 'constant-vus',
      vus: 50,
      duration: '30s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.05'],
    http_req_duration: ['p(95)<500'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3001';
const USERNAME = __ENV.USERNAME || 'loadtest';
const PASSWORD = __ENV.PASSWORD || 'loadtest-password';

export default function () {
  const res = http.post(
    `${BASE_URL}/api/v1/auth/login`,
    JSON.stringify({ username: USERNAME, password: PASSWORD }),
    { headers: { 'content-type': 'application/json' } },
  );
  check(res, {
    'status is 200': (r) => r.status === 200,
    'has token': (r) => typeof r.json('token') === 'string',
  });
}
