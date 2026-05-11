# Load tests (k6)

Three scenarios that stress different parts of the stack. Install k6 first
(`brew install k6` on macOS) and start the local stack (`docker compose up -d`
+ `pnpm dev`) before running.

## Scenarios

| Script | What it does |
|---|---|
| `login-storm.js` | 50 concurrent VUs hammer `POST /api/v1/auth/login` for 30s. |
| `lobby-poll.js`  | 100 VUs poll `GET /api/v1/rooms` every 2s for 60s (mirrors the live lobby polling cadence). |
| `game-play.js`   | 50 concurrent 2P games over Socket.io (100 VUs, paired). |

## Running

```bash
# Start a local stack first
docker compose up -d
pnpm dev

# In a separate shell:
k6 run apps/server/test/load/lobby-poll.js
k6 run apps/server/test/load/login-storm.js
k6 run apps/server/test/load/game-play.js
```

Set `BASE_URL` / `WS_URL` to target a non-local server.

The login + game-play scripts assume seeded accounts named `loadtest`,
`loadtest-a-*`, `loadtest-b-*` with password `loadtest-password`. Seed via the
register endpoint or extend `db:seed` if you want to run them regularly.
