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
#  - Prisma's postinstall — leftover from the migration window. PR-6
#    drops Prisma from package.json entirely.
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts

# Copy sources
COPY . .

# Build chain: shared types first, then DB package (Drizzle schema +
# migrate entry), then tickets-core (services), then the bot bundle.
# The `db:generate` step (Prisma client) is still here because Prisma
# is in package.json until PR-6; it's a build-only artifact never
# loaded at runtime.
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

COPY --from=builder /out/dist ./dist
COPY --from=builder /out/node_modules ./node_modules
COPY --from=builder /out/package.json ./package.json
# Migration SQL files. The bot's `runMigrations()` reads from this
# folder relative to its own dist location at boot, so they have to
# ship into the runtime stage.
COPY --from=builder /repo/packages/database/dist ./node_modules/@hearth/database/dist
COPY --from=builder /repo/packages/database/drizzle ./node_modules/@hearth/database/drizzle

ENV NODE_ENV=production
USER node
EXPOSE 3000

# Bot calls runMigrations() before opening the Discord gateway — see
# apps/bot/src/index.ts. Failure exits 1 so the operator's
# `restart: unless-stopped` policy surfaces it. tini relays SIGTERM
# to node which handles graceful shutdown.
ENTRYPOINT ["/sbin/tini", "--", "node", "dist/index.js"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --quiet --spider http://localhost:3000/healthz || exit 1
