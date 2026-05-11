# Deploy

Production deploy notes. Local dev: see [README.md](../README.md).

## Fly.io deploy (current target)

Two apps: `cc-server` (Node + Express + Socket.io) and `cc-web` (nginx serving the SPA, reverse-proxying `/api` and `/socket.io` to `cc-server` over the Fly internal network).

### One-time setup

```bash
# 1. Install + log in
brew install flyctl                                  # or: curl -L https://fly.io/install.sh | sh
fly auth login

# 2. Create the apps (idempotent — skip if they already exist)
fly apps create cc-server --org personal
fly apps create cc-web    --org personal

# 3. Provision managed Postgres and attach (writes DATABASE_URL into cc-server secrets)
fly postgres create --name cc-db --region iad --vm-size shared-cpu-1x --volume-size 1
fly postgres attach cc-db --app cc-server

# 4. Provision managed Redis (Upstash) and attach (writes REDIS_URL into cc-server secrets)
fly redis create --name cc-redis --region iad --no-replicas
fly redis attach cc-redis --app cc-server

# 5. Set required server secrets
fly secrets set --app cc-server \
  JWT_SECRET="$(openssl rand -hex 32)" \
  JWT_REFRESH_SECRET="$(openssl rand -hex 32)" \
  CLIENT_URL="https://cc-web.fly.dev"

# Optional: Google OAuth, Sentry, S3 avatars
# fly secrets set --app cc-server GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... \
#   GOOGLE_CALLBACK_URL=https://cc-web.fly.dev/api/v1/auth/google/callback
# fly secrets set --app cc-server SENTRY_DSN=...
# fly secrets set --app cc-server AWS_REGION=us-east-1 AWS_S3_BUCKET=... \
#   AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=...
```

### Deploy

From the monorepo root:

```bash
pnpm deploy:server     # builds + deploys apps/server
pnpm deploy:web        # builds + deploys apps/web
pnpm deploy            # both, server first
```

The web Dockerfile bakes `SERVER_UPSTREAM=cc-server.internal:3001` (Fly internal DNS).

### Dry run

```bash
fly deploy --config apps/server/fly.toml --dockerfile apps/server/Dockerfile . --build-only
fly deploy --config apps/web/fly.toml    --dockerfile apps/web/Dockerfile    . --build-only
```

### CI deploy

[.github/workflows/deploy.yml](../.github/workflows/deploy.yml) deploys both apps on push to `main` after CI passes. Add a `FLY_API_TOKEN` repo secret:

```bash
fly tokens create deploy --name github-actions   # copy into GitHub → Settings → Secrets → FLY_API_TOKEN
```

### Smoke test

After deploy:

```bash
curl -fsS https://cc-web.fly.dev/api/v1/health
# {"ok":true}
```

The CI deploy workflow runs this with 5× retries on 10s backoff to absorb cold-start latency.

### Custom domain

```bash
fly certs add play.example.com --app cc-web
# Then add the AAAA + A records Fly prints to your DNS provider, and:
fly secrets set --app cc-server CLIENT_URL=https://play.example.com
```

---


## Required environment

Validated at startup by [apps/server/src/env.ts](../apps/server/src/env.ts).

| Var | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string in prod (`postgresql://…`) |
| `JWT_SECRET` | yes | Must NOT be the default in `NODE_ENV=production` — startup throws |
| `CLIENT_URL` | yes | Origin for CORS + Socket.io (must match the deployed web origin) |
| `NODE_ENV` | yes | `production` |
| `ADMIN_USER_ID` | optional | User id with access to `GET /admin/games` diagnostic |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_CALLBACK_URL` | optional | Enables Google OAuth |
| `AWS_S3_BUCKET` / `AWS_REGION` / `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | optional | Enables avatar uploads |
| `REDIS_URL` | optional | Reserved for Socket.io adapter swap |
| `SENTRY_DSN` | optional | Error reporting |

## Switch Prisma to Postgres

1. In [apps/server/prisma/schema.prisma](../apps/server/prisma/schema.prisma), set `provider = "postgresql"`.
2. Point `DATABASE_URL` at the Postgres instance.
3. `pnpm --filter server exec prisma migrate deploy`.

## Build + run

```bash
pnpm install --frozen-lockfile
pnpm build                                  # builds shared-types, game-engine, server, web
node apps/server/dist/index.js              # or run under your process manager (systemd, pm2, fly, etc.)
```

Serve `apps/web/dist` as static assets from the same origin as the API. CSP and cookie settings assume same-origin; cross-origin deploys will need explicit allowlists.

## Reverse proxy

Terminate TLS at the proxy. Forward the `Upgrade` and `Connection` headers so Socket.io can complete its WebSocket handshake. Example (nginx):

```nginx
location /socket.io/ {
  proxy_pass http://app;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
}
```

## Scaling

Active game state (rooms, move log, turn timers) lives in process memory. Run a **single server instance** until a Redis adapter is wired up for Socket.io and a Redis-backed store replaces the in-memory `rooms` map in [apps/server/src/store.ts](../apps/server/src/store.ts). Use sticky sessions if you must run multiple instances in the interim.

## Admin diagnostic

With `ADMIN_USER_ID` set, the admin user can hit `GET /api/v1/admin/games` for a read-only snapshot of in-flight rooms (player counts, move counts, elapsed time). Non-admins see 404.
