# syntax=docker/dockerfile:1.7
#
# Dockerfile for @ilr/api.
#
# Build context MUST be the repository root (not apps/api), because we need
# the workspace lockfile and the @ilr/db + @ilr/shared packages.
#
# Railway settings to match:
#   Builder:        Dockerfile
#   Dockerfile Path: apps/api/Dockerfile
#   (no Custom Build/Start Command — the Dockerfile drives both)

FROM node:22-slim

WORKDIR /app

# Prisma needs openssl + ca-certificates at runtime (engine TLS, query engine).
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# pnpm via corepack, pinned to whatever the repo declares.
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# ---- 1. Install deps -------------------------------------------------------
# Copy only the metadata first so this layer caches when source changes
# but lockfile + package.json files do not.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json turbo.json tsconfig.base.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/db/package.json ./packages/db/
COPY packages/db/prisma ./packages/db/prisma
COPY packages/shared/package.json ./packages/shared/

RUN pnpm install --frozen-lockfile

# ---- 2. Build --------------------------------------------------------------
# Copy the actual source for the api + its workspace dependencies.
COPY packages/shared ./packages/shared
COPY packages/db ./packages/db
COPY apps/api ./apps/api

# Generate the Prisma client, then let turbo build @ilr/api and any
# workspace deps it pulls in (@ilr/db, @ilr/shared) in topological order.
RUN pnpm --filter @ilr/db run db:generate \
    && pnpm turbo build --filter=@ilr/api

# ---- 3. Runtime ------------------------------------------------------------
ENV NODE_ENV=production
ENV API_HOST=0.0.0.0
# Railway (and most PaaS) inject their own PORT env var at runtime — Railway
# currently uses 8080. The values below are only the defaults for a bare
# `docker run` locally, and EXPOSE is informational metadata, not enforced.
# When deploying, make sure the platform's public-domain target port matches
# whatever PORT it injects (e.g. Railway: 8080), not 3001.
ENV PORT=3001
EXPOSE 3001

# Run node directly (not via pnpm) so Node is PID 1 and SIGTERM reaches it.
CMD ["node", "apps/api/dist/index.js"]
