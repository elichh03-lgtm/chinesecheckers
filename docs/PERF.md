# Performance & cold-start

How we keep the app fast on first paint and quiet under load. Update this doc
whenever the bundle composition or caching strategy changes meaningfully.

## Web bundle: route-level code splitting

The hot path on cold start is `/` (Landing) and `/lobby`. Everything else loads
on demand via `React.lazy` + `Suspense`. See `apps/web/src/App.tsx`.

Eager (in `index-*.js`):

- Landing, Lobby, Game (`/game/:gameId`)
- Toaster, Auth, Socket bridge

Lazy chunks (one per route, fetched only when navigated to):

- Replay (engine + canvas reconstruction)
- Profile
- EditProfile (avatar upload UI)
- Leaderboard
- Forgot, Reset (password flow)

### Build output after the split (gzip)

| Chunk | Gzipped |
|---|---|
| `index-*.js` (Landing + Lobby + Game + shared) | **101.4 kB** |
| `index-*.css`                                  | 5.3 kB |
| `EditProfile-*.js`                             | 4.4 kB |
| `Profile-*.js`                                 | 2.7 kB |
| `Replay-*.js`                                  | 2.3 kB |
| `Reset-*.js`                                   | 1.5 kB |
| `Forgot-*.js`                                  | 0.9 kB |
| `Leaderboard-*.js`                             | 0.8 kB |
| `index.html`                                   | 0.4 kB |
| **Total (gzipped)**                            | **~119.7 kB** |

Before splitting these routes were all in the single `index-*.js` chunk. Profile
+ EditProfile + Replay alone account for ~9 kB gzip that a first-time visitor
no longer pays.

### Budgets enforced in CI

`.github/workflows/ci.yml`:

- Each `dist/assets/*.{js,css}` chunk **must be ≤ 250 kB gzipped**.
- Total of all `dist/assets/*.{js,css}` **must be ≤ 600 kB gzipped**.

CI fails if either threshold is exceeded.

### Re-analyzing the bundle

```bash
pnpm --filter web analyze
# writes apps/web/dist/stats.html and opens it
```

Powered by `rollup-plugin-visualizer`. `dist/` is gitignored, so the report
stays local.

## Server: lobby caching

The lobby polls `GET /api/v1/rooms` every 2s. The handler now coalesces
concurrent pollers behind a 1 s in-memory cache (`apps/server/src/routes.ts`).
At 100 concurrent clients that drops the underlying store reads from
~3 000 / min to ~60 / min.

## Cache-Control headers

| Endpoint | Header | Why |
|---|---|---|
| `GET /api/v1/health` | `no-store` | Always reflect live status. |
| `GET /api/v1/games/:id` (completed games only) | `public, max-age=86400, immutable` | Replays never change once a game ends. |
| `GET /api/v1/leaderboard` | `public, max-age=60` | OK to be a minute stale. |
| `GET /api/v1/users/:username` | `public, max-age=300` | Profile pages change rarely. |
| `GET /api/v1/rooms` | `public, max-age=1` | Mirrors the server-side cache TTL. |

## Image lazy-loading

All avatar `<img>` tags (`Profile.tsx`, `EditProfile.tsx`) use `loading="lazy"`
so off-viewport images don't block first paint.

## Load testing

k6 scenarios live in `apps/server/test/load/` — see the README in that
directory. Three scenarios:

- `login-storm.js` — 50 concurrent `POST /auth/login` for 30 s.
- `lobby-poll.js`  — 100 clients polling `/rooms` every 2 s for 60 s.
- `game-play.js`   — 50 concurrent 2P games run to completion over Socket.io.

```bash
brew install k6
docker compose up -d && pnpm dev
k6 run apps/server/test/load/lobby-poll.js
```

## Out of scope (intentionally)

- CDN / edge caching
- Service worker / PWA shell caching
- Image CDN / responsive avatar sizes
