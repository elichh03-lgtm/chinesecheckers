# Chinese Checkers Online (Halma)

[![CI](https://github.com/elichh03-lgtm/sight-web/actions/workflows/ci.yml/badge.svg)](https://github.com/elichh03-lgtm/sight-web/actions/workflows/ci.yml)

Real-time multiplayer Chinese Checkers (Sternhalma). Bcrypt + JWT auth, rotating refresh tokens, CSP-hardened, Prisma-backed persistence for users, ELO, and completed games.

## Quick start

Requires Docker Desktop and Node.js ≥20.

```bash
# 1. Install workspace deps
npx pnpm@9 install

# 2. Start Postgres + Redis (+ Adminer at :8080)
docker compose up -d

# 3. Run server + web together (port 3001 + 5173)
#    The server's `predev` hook applies Prisma migrations automatically,
#    so a fresh checkout self-heals on first dev start.
npx pnpm@9 dev

# 4. Open http://localhost:5173 in two browsers, sign in with different
#    usernames, create a 2-player room in one, join from the other's lobby.
```

The server reads `apps/server/.env`; copy from `.env.example` if it's missing.

### Test database (one-time)

The server test suite (`apps/server`) talks to a real Postgres at
`chinesecheckers_test` and to Redis DB 15. Create the DB and migrate it:

```bash
docker compose exec -T postgres psql -U postgres -c "CREATE DATABASE chinesecheckers_test;"
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/chinesecheckers_test \
  npx pnpm@9 --filter server exec prisma migrate deploy
```

## Layout

- `packages/shared-types` — typescript contracts (events, payloads, GameState shape)
- `packages/game-engine` — pure game rules, 63 tests
- `apps/server` — Express + Socket.io, Postgres (Prisma) + Redis (ioredis)
- `apps/web` — React + Vite + Canvas board renderer

## Common commands

```bash
npx pnpm@9 typecheck                          # all workspaces
npx pnpm@9 -r test                            # 63 engine + 47 server tests
npx pnpm@9 --filter @cc/game-engine test:coverage
cd apps/web && npx playwright test            # 6 E2E
```

## Deploy

See [docs/DEPLOY.md](docs/DEPLOY.md) for production deploy steps — Postgres setup, env vars, build, and reverse-proxy + sticky-session notes for the Socket.io layer.

## What's open

Active room state is in Redis but Socket.io still needs the Redis adapter for multi-replica horizontal scaling. Mobile polish, sounds, and CI are still on the roadmap. See `CLAUDE.md` for the phase checklist.
