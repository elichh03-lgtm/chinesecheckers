# syntax=docker/dockerfile:1.7
# Multi-stage build for the Chinese Checkers server.
# Build context must be the monorepo root (not apps/server).

ARG NODE_VERSION=20-alpine

# ---------- Stage 1: deps ----------
FROM node:${NODE_VERSION} AS deps
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY tsconfig.base.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/game-engine/package.json packages/game-engine/
COPY packages/shared-types/package.json packages/shared-types/
RUN pnpm install --frozen-lockfile

# ---------- Stage 2: build ----------
FROM deps AS build
COPY packages/shared-types packages/shared-types
COPY packages/game-engine packages/game-engine
COPY apps/server apps/server
RUN pnpm --filter @cc/shared-types build \
 && pnpm --filter @cc/game-engine build \
 && pnpm --filter server exec prisma generate \
 && pnpm --filter server build

# ---------- Stage 3: runtime ----------
FROM node:${NODE_VERSION} AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache tini curl
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

# Copy workspace metadata so pnpm can resolve the workspace deps.
COPY --from=build /repo/pnpm-workspace.yaml /repo/pnpm-lock.yaml /repo/package.json ./
COPY --from=build /repo/apps/server/package.json apps/server/
COPY --from=build /repo/packages/game-engine/package.json packages/game-engine/
COPY --from=build /repo/packages/shared-types/package.json packages/shared-types/
# These packages publish from source (main points at src/index.ts) — copy src.
COPY --from=build /repo/packages/shared-types/src packages/shared-types/src
COPY --from=build /repo/packages/game-engine/src packages/game-engine/src

# Production deps only (Prisma client + runtime libs).
RUN pnpm install --prod --frozen-lockfile --filter server...

# Built server output and Prisma schema for `migrate deploy` at boot.
COPY --from=build /repo/apps/server/dist apps/server/dist
COPY --from=build /repo/apps/server/prisma apps/server/prisma

# Non-root user.
RUN addgroup -S app && adduser -S app -G app && chown -R app:app /app
USER app

EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD curl -f http://localhost:3001/api/v1/health || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["sh", "-c", "pnpm --filter server exec prisma migrate deploy && node apps/server/dist/index.js"]
