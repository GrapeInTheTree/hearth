# syntax=docker/dockerfile:1.7
# Multi-stage build for the dashboard. Produces a minimal Node 22 image
# running Next.js's `output: 'standalone'` server.

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
COPY apps/dashboard/package.json ./apps/dashboard/
COPY packages/shared/package.json ./packages/shared/
COPY packages/database/package.json ./packages/database/
COPY packages/tickets-core/package.json ./packages/tickets-core/
COPY packages/eslint-config/package.json ./packages/eslint-config/
COPY packages/tsconfig/package.json ./packages/tsconfig/

# Install all deps (incl. dev). --ignore-scripts skips lefthook prepare
# (alpine has no git) and Prisma's postinstall (we run db:generate
# explicitly below).
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts

# Copy sources
COPY . .

# Build chain: prisma client -> shared -> database -> tickets-core -> dashboard.
# `next build` is the dashboard's build step; placeholder env vars come
# from apps/dashboard/package.json's build script (the build evaluates
# env validation but never reaches the network).
RUN pnpm --filter @hearth/database run db:generate && \
    pnpm --filter @hearth/shared run build && \
    pnpm --filter @hearth/database run build && \
    pnpm --filter @hearth/tickets-core run build && \
    pnpm --filter @hearth/dashboard run build

# ──────────────────────────────────────────────────────────────────
# Stage 2: runtime
# ──────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-alpine AS runtime
WORKDIR /app

# tini handles signal forwarding so the Next.js server gets a clean
# SIGTERM on `docker compose stop`.
RUN apk add --no-cache tini

# Next.js standalone bundle: server.js + minimal node_modules. We copy
# the static assets and public/ alongside per the official template.
# Workspace packages are inlined into the standalone .next/server build,
# so no separate node_modules copy is required for them — but @prisma/*
# binary engines live under node_modules and Next includes those in the
# standalone bundle automatically.
COPY --from=builder --chown=node:node /repo/apps/dashboard/.next/standalone ./
COPY --from=builder --chown=node:node /repo/apps/dashboard/.next/static ./apps/dashboard/.next/static
COPY --from=builder --chown=node:node /repo/apps/dashboard/public ./apps/dashboard/public

ENV NODE_ENV=production
ENV PORT=3200
USER node
EXPOSE 3200

# The standalone server lives at apps/dashboard/server.js relative to /app
# (Next preserves the workspace path).
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/dashboard/server.js"]

# /login is the cheapest 200 in the route set — it doesn't fetch the
# database. wget ships with busybox.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget --quiet --spider http://localhost:3200/login || exit 1
