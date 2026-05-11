# syntax=docker/dockerfile:1.7
# Build context must be the monorepo root.

ARG NODE_VERSION=20-alpine

# ---------- Stage 1: build ----------
FROM node:${NODE_VERSION} AS build
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/game-engine/package.json packages/game-engine/
COPY packages/shared-types/package.json packages/shared-types/
RUN pnpm install --frozen-lockfile

COPY packages/shared-types packages/shared-types
COPY packages/game-engine packages/game-engine
COPY apps/web apps/web

ARG VITE_SENTRY_DSN=""
ENV VITE_SENTRY_DSN=${VITE_SENTRY_DSN}
RUN pnpm --filter @cc/shared-types build \
 && pnpm --filter @cc/game-engine build \
 && pnpm --filter web build

# ---------- Stage 2: runtime ----------
FROM nginx:1.27-alpine AS runtime
RUN apk add --no-cache gettext
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/templates/default.conf.template
ENV SERVER_UPSTREAM=cc-server.internal:3001
EXPOSE 80
# nginx:alpine's entrypoint runs envsubst on files in /etc/nginx/templates.
CMD ["nginx", "-g", "daemon off;"]
