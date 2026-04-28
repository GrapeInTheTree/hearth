# syntax=docker/dockerfile:1.7
# Multi-stage build — produces a minimal Node 22 image with only prod deps.

ARG NODE_VERSION=22.22.0
ARG PNPM_VERSION=10.14.0

# ──────────────────────────────────────────────────────────────────
# Stage 1: build
# ──────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-alpine AS builder
WORKDIR /repo

# Enable pnpm via corepack
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

# Copy lockfile + workspace manifests for layer caching
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/bot/package.json ./apps/bot/
COPY packages/shared/package.json ./packages/shared/
COPY packages/database/package.json ./packages/database/
COPY packages/tickets-core/package.json ./packages/tickets-core/
COPY packages/eslint-config/package.json ./packages/eslint-config/
COPY packages/tsconfig/package.json ./packages/tsconfig/

# Install all deps (incl. dev). --ignore-scripts skips:
#  - root `prepare` (lefthook install) — needs git which alpine lacks;
#  - Prisma's postinstall — we run `prisma generate` explicitly below.
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts

# Copy sources
COPY . .

# Build chain: generate Prisma client -> build packages -> build bot
RUN pnpm --filter @hearth/database run db:generate && \
    pnpm --filter @hearth/shared run build && \
    pnpm --filter @hearth/database run build && \
    pnpm --filter @hearth/tickets-core run build && \
    pnpm --filter @hearth/bot run build

# Deploy bot with prod-only deps to /out. --legacy is required since
# pnpm 10 made injected workspaces the default and our workspaces are
# non-injected (the symlink-based default that the rest of the toolchain
# assumes). --ignore-scripts again skips the root prepare hook.
RUN pnpm --filter @hearth/bot deploy --prod --legacy --ignore-scripts /out

# ──────────────────────────────────────────────────────────────────
# Stage 2: runtime
# ──────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-alpine AS runtime
WORKDIR /app

# tini for proper signal handling. wget is in busybox already (HEALTHCHECK uses it).
RUN apk add --no-cache tini

# pnpm is needed at runtime to invoke `prisma migrate deploy` from the
# entrypoint. Installing via corepack keeps the version pinned to the
# build-time toolchain.
ARG PNPM_VERSION
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

# --chown ensures the `node` user can write to the prisma engines cache
# directory (the migrate CLI lazily downloads/extracts engine binaries
# even on the no-Rust-engine v7 — it's the migration engine specifically).
COPY --from=builder --chown=node:node /out/dist ./dist
COPY --from=builder --chown=node:node /out/node_modules ./node_modules
COPY --from=builder --chown=node:node /out/package.json ./package.json
COPY --from=builder --chown=node:node /repo/packages/database ./packages/database

ENV NODE_ENV=production
USER node
EXPOSE 3000

# Migrate the schema then start. If migrations fail we fail loudly via `set
# -e` rather than silently boot against a stale DB. dumb-init/tini relays
# SIGTERM to node which already handles graceful shutdown.
ENTRYPOINT ["/sbin/tini", "--", "/bin/sh", "-c"]
CMD ["set -e; pnpm --silent --prefix packages/database exec prisma migrate deploy; exec node dist/index.js"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --quiet --spider http://localhost:3000/healthz || exit 1
