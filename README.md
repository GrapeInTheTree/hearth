<p align="center">
  <h1 align="center">Hearth</h1>
  <p align="center">
    <strong>A white-label Discord community ops platform.</strong>
  </p>
  <p align="center">
    Tickets, panels, moderation — operated like infrastructure. One codebase, deployed per community.
  </p>
</p>

<p align="center">
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node.js-22.22%20LTS-339933?logo=node.js" alt="Node.js" /></a>
  <a href="https://pnpm.io/"><img src="https://img.shields.io/badge/pnpm-10.14-F69220?logo=pnpm" alt="pnpm" /></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5.8%20strict-3178C6?logo=typescript" alt="TypeScript" /></a>
  <a href="https://discord.js.org/"><img src="https://img.shields.io/badge/discord.js-14.26-5865F2?logo=discord" alt="discord.js" /></a>
  <a href="https://www.sapphirejs.dev/"><img src="https://img.shields.io/badge/Sapphire-5.5-2E2E2E" alt="Sapphire" /></a>
  <a href="https://nextjs.org/"><img src="https://img.shields.io/badge/Next.js-15.5-000000?logo=next.js" alt="Next.js" /></a>
  <a href="https://orm.drizzle.team/"><img src="https://img.shields.io/badge/Drizzle-0.45-C5F74F" alt="Drizzle ORM" /></a>
  <a href="https://www.postgresql.org/"><img src="https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql" alt="Postgres" /></a>
</p>

---

## Table of Contents

- [Why Hearth](#why-hearth)
- [Status](#status)
- [Architecture](#architecture)
- [Project Structure](#project-structure)
- [Quick Start](#quick-start)
- [Operating Hearth](#operating-hearth)
- [White-label Branding](#white-label-branding)
- [Environment Variables](#environment-variables)
- [Development](#development)
- [Testing](#testing)
- [Deployment](#deployment)
- [Quality Gates](#quality-gates)
- [License](#license)

---

## Why Hearth

Most Discord bots make you choose between two bad options:

- **Hosted SaaS** (MEE6, Carl, Tickety) — you pay per server, your data lives on someone else's infrastructure, and rebranding requires their premium tier.
- **A single-tenant fork** — you own the code, but operating multiple communities means maintaining N forks and merging upstream by hand.

Hearth is the third option. **One codebase, deployed per community.** Each deploy gets its own Discord application token, its own domain, its own database — full operational isolation. Onboarding a new community is `cp .env.example .env && docker compose up -d`. Zero code changes.

The design rests on three principles:

- **Brand via configuration.** Bot name, color, icon, footer, locale, copy — all env-driven. Hardcoded community names are caught by an ESLint rule and a CI grep gate.
- **Operate like infrastructure.** Versioned, auditable, reproducible. Every operator change goes through Discord slash commands or the web dashboard, not a JSON file someone forgot to commit.
- **Bot ↔ dashboard, two surfaces, one source of truth.** The ticket domain logic lives in `@hearth/tickets-core` — both the bot's slash command flow and the dashboard's Server Actions call into it. Discord is touched exclusively by the bot via a single `DiscordGateway` port.

The result is a stack that feels like MEE6 to end users but reads like infrastructure to operators.

---

## Status

**Live in production.** Hearth runs on a VM at `community-bot.namusunmul.com` with four domains shipping: tickets, verification, reaction-roles, and role-picker. Operators CRUD everything through the web dashboard or Discord slash commands. Race-safe concurrency via Postgres advisory locks plus partial unique indexes.

| Metric                                           | Value                                                                                                        |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Domain packages                                  | `tickets-core` · `verification-core` · `reaction-roles-core` · `role-picker-core`                            |
| Unit tests                                       | **369 passing** (tickets 101 · verification 41 · reaction-roles 48 · role-picker 36 · bot 46 · dashboard 97) |
| Integration tests (testcontainers + Postgres 16) | **8 / 8** passing                                                                                            |
| Triggers ratified                                | button (verification, welcome) · reaction (reaction-roles, polls) · select-menu (role-picker)                |
| Production build                                 | `./infra/deploy.sh` → git pull + image build + recreate → healthy in ~30s                                    |

**Next:** Phase 3 — Moderation + AutoMod.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Discord Gateway (WSS)                                │
└────────────────────────────┬────────────────────────────────────────────────┘
                             │  events
                             ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                       apps/bot — Discord runtime                             │
├─────────────────────────────────────────────────────────────────────────────┤
│   commands/   listeners/   interaction-handlers/   preconditions/            │
│   ───────────────────────────────────────────────────────────────────────    │
│   internal-api/ ── /healthz · /internal/guilds/* · /internal/panels/*        │
│                    bearer-auth (timingSafeEqual against INTERNAL_API_TOKEN)  │
└────────────────────────────┬────────────────────────────────────────────────┘
                             │  HTTP (Bearer token)
                             ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    apps/dashboard — Next.js 15 (App Router)                  │
├─────────────────────────────────────────────────────────────────────────────┤
│   /login → /select-guild → /g/[guildId]/{,panels,tickets,settings}/          │
│   Server Actions (panels · ticket-types · guild-config) → DB write           │
│                                                       → botClient.callBot()  │
│   Auth.js v5 + Discord OAuth (identify + guilds scopes)                      │
└────────────────────────────┬────────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│           Domain packages — single source of truth per surface               │
├─────────────────────────────────────────────────────────────────────────────┤
│   @hearth/tickets-core         · PanelService · TicketService · ports/      │
│   @hearth/verification-core    · VerificationService (button trigger)        │
│   @hearth/reaction-roles-core  · ReactionRolesService (reaction trigger)     │
│   @hearth/role-picker-core     · RolePickerService (select-menu trigger)     │
│   ───────────────────────────────────────────────────────────────────────    │
│   DiscordGateway composite port = T & V & R & P sub-interfaces              │
│   zod schemas · i18n bundle · discord-api-types only (zero djs runtime)     │
└────────────────────────────┬────────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                @hearth/database — Drizzle 0.45 + node-postgres               │
│   Hand-written schema · drizzle-kit generated migrations (0000–0005)         │
│   Tickets · Verification · ReactionRoles · RolePicker (3 tables each)        │
│   runMigrations() auto-applies at bot boot · cuid2 IDs                       │
│   Race safety: pg_advisory_xact_lock + partial unique indexes                │
│   FK ON DELETE SET NULL + snapshot columns for audit-log retention           │
└────────────────────────────┬────────────────────────────────────────────────┘
                             ▼
                      PostgreSQL 16 (compose)
```

### Technology Stack

| Layer             | Choice                                                                                   |
| ----------------- | ---------------------------------------------------------------------------------------- |
| **Runtime**       | Node.js 22.22 LTS                                                                        |
| **Language**      | TypeScript 5.8 (strict)                                                                  |
| **Discord SDK**   | discord.js 14.26 + Sapphire Framework 5.5                                                |
| **Database**      | PostgreSQL 16 + Drizzle ORM 0.45 (hand-written schema, drizzle-kit migrations)           |
| **Web**           | Next.js 15.5 + React 19 + App Router + Server Actions                                    |
| **UI**            | Tailwind v4 + shadcn/ui + Auth.js v5 (Discord OAuth)                                     |
| **Build**         | tsup (bot) · Next.js standalone (dashboard) · tsx (dev watch)                            |
| **Monorepo**      | pnpm 10 workspaces + Turborepo                                                           |
| **Tests**         | Vitest 4 + testcontainers (Postgres 16)                                                  |
| **Lint / Format** | ESLint 9 (flat) + Prettier 3                                                             |
| **Hooks**         | lefthook + commitlint + gitleaks                                                         |
| **Logging**       | Sapphire logger (pino-compatible)                                                        |
| **Deploy**        | GCP Compute Engine VM + docker compose · operator's nginx for TLS · registry-less builds |

### Architectural Decisions

- **Self-hosted multi-tenancy.** Each community owns its Discord application and runs its own Hearth instance. No cross-community shared state.
- **One domain package per feature family.** `@hearth/tickets-core`, `@hearth/verification-core`, `@hearth/reaction-roles-core`, and `@hearth/role-picker-core` are siblings — same form factor (facade + operations + builder + zod schemas + i18n + PGlite tests), each owning one trigger pattern. New domains import the shared `DiscordGateway` composite port; they never re-implement Discord plumbing.
- **Three triggers, domain by domain.** Button (verification, welcome, moderation) · reaction (reaction-roles, polls) · select-menu (role-picker, future country pickers). The service layer stays trigger-agnostic; the same domain never tries to host two triggers.
- **Zero discord.js in domain packages or dashboard.** Domain packages use `discord-api-types` (types-only). The dashboard never holds a Discord bot token — every Discord-side render goes through the bot's internal HTTP API (`/internal/*`, bearer-authed with a shared token).
- **Concurrency belt-and-suspenders.** A double-clicked panel button is blocked at two layers: a Postgres advisory transaction lock keyed by `(guildId, openerId, panelTypeId)`, and a partial unique index on the same tuple constrained to active states. Either alone is sufficient.
- **Operator-driven configuration.** Panels, types, options, and settings are CRUD'd at runtime via slash commands or the dashboard. Onboarding a new community requires zero code changes.
- **Self-hosted dashboard, not Vercel.** Hearth's white-label thesis is "one `docker compose up` and you're done." A Vercel + Neon split would add two external dependencies per deploy. Instead, the dashboard runs in the same compose stack as the bot, and the operator's existing nginx terminates TLS.
- **Graceful degradation under bot downtime.** Dashboard mutations always commit the DB write first, then call the bot's render endpoint. If the bot is unreachable, the operator sees "Saved. Discord re-render queued — retry," and a Retry sync button replays the call when the bot is back.
- **Audit retention survives option deletion.** Every audit event (verification submissions, reaction-roles grants, role-picker selections) snapshots option label/emoji/roleId at write-time. Option FK uses `ON DELETE SET NULL` so operators can prune options without losing history.

---

## Project Structure

```
hearth/
├── apps/
│   ├── bot/                              # Discord runtime — discord.js + Sapphire
│   │   ├── src/
│   │   │   ├── commands/                 # Slash commands (per domain folder)
│   │   │   ├── listeners/                # Sapphire listeners (1 file = 1 piece)
│   │   │   ├── interaction-handlers/     # Buttons + modals (Sapphire convention)
│   │   │   ├── preconditions/            # AdminOnly, GuildOnly
│   │   │   ├── services/                 # Light shells around tickets-core (zero djs leak)
│   │   │   │   └── ports/discordGateway.djs.ts   # The only file that imports discord.js
│   │   │   ├── internal-api/             # /healthz + /internal/* HTTP server
│   │   │   ├── lib/                      # Bot-only utils (interactionHelpers, replyEphemeral)
│   │   │   ├── config/                   # Zod env, branding (frozen)
│   │   │   ├── i18n/                     # common copy; tickets domain copy lives in tickets-core
│   │   │   ├── container.ts              # Sapphire DI
│   │   │   └── index.ts                  # Bootstrap
│   │   ├── tests/                        # Unit + integration suites
│   │   └── Dockerfile
│   └── dashboard/                        # Next.js 15 web UI
│       ├── src/
│       │   ├── app/                      # App Router (login, select-guild, /g/[id]/{panels,tickets,settings})
│       │   ├── actions/                  # Server Actions (panels, ticket-types, guild-config, auth)
│       │   ├── components/{ui,layout,panels,pickers,settings}/
│       │   ├── lib/                      # auth, env, botClient, server-auth, discordOauth
│       │   ├── config/branding.ts        # mirrors bot env keys
│       │   ├── i18n/                     # dashboard chrome copy
│       │   └── middleware.ts             # edge-compatible cookie gate
│       ├── tests/unit/
│       └── Dockerfile                    # Next.js standalone output
├── packages/
│   ├── tickets-core/                     # Tickets domain + composite DiscordGateway port host
│   │   └── src/{panel,ticket,guildConfig}Service.ts · ports/ · lib/ · schemas.ts · i18n/
│   ├── verification-core/                # Verification domain (button trigger, DEFI-658)
│   ├── reaction-roles-core/              # Reaction-based role-self-assignment (DEFI-661)
│   ├── role-picker-core/                 # StringSelectMenu-based role picker
│   ├── database/                         # Drizzle schema + lazy NodePgDatabase Proxy + runMigrations()
│   ├── shared/                           # Result, AppError, ActionError, cross-app types
│   ├── tsconfig/                         # base.json, bot.json, web.json
│   └── eslint-config/                    # Shared ESLint flat config
├── infra/
│   ├── docker-compose.yml                # bot + dashboard + postgres
│   ├── deploy.sh                         # VM-side: pull + token check + build + up + logs
│   └── nginx/dashboard.conf.example
├── docs/runbook/
│   ├── 02-dashboard-deploy.md            # Full deploy runbook
│   └── 03-pre-deploy-checklist.md        # Gate-by-gate operator checklist
└── .github/workflows/                    # CI: typecheck, lint, test, build, white-label
```

### Invariants

- Each feature family lives in exactly one `@hearth/<domain>-core` package. Both bot and dashboard import from it — never duplicate the schema or the constraint logic.
- Domain packages never import `discord.js`. Only `discord-api-types` (types-only). The discord.js gateway implementation lives in `apps/bot/src/services/ports/discordGateway.djs.ts` and nowhere else.
- `apps/dashboard/src/` does not import `discord.js`. Discord-side rendering goes through `botClient.callBot('/internal/...')`.
- The Drizzle client is exported as `dbDrizzle` from `@hearth/database` (lazy `Proxy` so it's Next.js build-time safe). Caller never imports `drizzle-orm/*` directly — `@hearth/database` re-exports the hot operators (`eq`, `and`, `inArray`, `asc`, `desc`, `count`, `sql`).
- DB error branching uses helpers (`isUniqueViolation`, `isLockNotAvailable`, `getConstraintName`) from `@hearth/database`, not raw SQLSTATE codes or `error instanceof PgError` patterns.
- Environment variables are validated once via Zod (`apps/{bot,dashboard}/src/{config,lib}/env.ts`). `process.env` is not read elsewhere.
- One Sapphire piece per file (Listener / Command / InteractionHandler / Precondition). Multiple exports are silently dropped by the loader.
- New domain packages (`@hearth/<name>-core`) must update **both** Dockerfiles in the same PR — explicit `pnpm --filter @hearth/<name>-core run build` + `COPY packages/<name>-core/package.json` (clean-VM build hardening, see PR #21).

---

## Quick Start

### Prerequisites

- Node.js **22.22.x** (use `nvm use` — `.nvmrc` is committed)
- pnpm **10+**
- Docker + Docker Compose v2
- A Discord application + bot token ([Developer Portal](https://discord.com/developers/applications))

### Setup

```bash
git clone https://github.com/GrapeInTheTree/hearth.git
cd hearth

nvm use                                   # picks up .nvmrc
pnpm install

cp apps/bot/.env.example apps/bot/.env
cp apps/dashboard/.env.example apps/dashboard/.env
# Fill in DISCORD_TOKEN, DISCORD_APP_ID, INTERNAL_API_TOKEN (same in both),
# NEXTAUTH_SECRET, BOT_NAME, BOT_BRAND_COLOR, DATABASE_URL.
```

### Local Development

```bash
# 1. Start Postgres (bot + dashboard run on host via watch)
docker compose -f infra/docker-compose.yml up -d postgres

# 2. Migrations apply automatically on bot boot via runMigrations().
#    Apply manually for dev without booting the bot:
pnpm --filter @hearth/database exec drizzle-kit migrate

# 3. Run the bot (one terminal) and the dashboard (another)
pnpm dev
pnpm --filter @hearth/dashboard dev
```

The bot registers its slash commands against `DISCORD_DEV_GUILD_ID` for instant updates. Without it, commands register globally (≈1h propagation). The dashboard listens on `http://localhost:3200`.

To generate a new migration after editing schema files in `packages/database/src/schema/`:

```bash
pnpm --filter @hearth/database exec drizzle-kit generate
```

Review the generated SQL before committing — `drizzle-kit` will auto-DROP+CREATE for renames, which is destructive. Non-additive changes are often safer hand-written.

---

## Operating Hearth

After Hearth is online and you've added the bot to your server, all configuration happens through Discord slash commands or the web dashboard. **No code changes, no env edits.**

### Features at a glance

| Domain         | Slash root         | Dashboard page           | Trigger          | What it does                                                               |
| -------------- | ------------------ | ------------------------ | ---------------- | -------------------------------------------------------------------------- |
| Tickets        | `/panel`, `/setup` | `/g/<id>/ticket-panels`  | Button           | Multi-type ticket panels → private channels with per-type categories       |
| Verification   | `/verification`    | `/g/<id>/verification`   | Button           | Emoji-button quiz → granted role on correct answer (configurable outcomes) |
| Reaction Roles | `/reactionroles`   | `/g/<id>/reaction-roles` | Reaction         | Emoji reactions toggle roles (language pickers, opt-in role flags)         |
| Role Picker    | `/rolepicker`      | `/g/<id>/role-picker`    | StringSelectMenu | Dropdown role selector with optional re-click to clear                     |

### Slash command flow (Discord-only operators)

```
/setup archive-category category:#archive
/setup log-channel channel:#bot-log

/panel create
    channel:#contact-team
    title:"Contact Team"
    description:"Have a question or proposal? Click a button below."

/panel ticket-type add
    panel:<panelId>
    name:question
    label:"Question"
    emoji:❓
    active-category:#community-questions
    support-roles:@Support
    per-user-limit:1
```

End users click a button on the panel — Hearth creates a private channel in the right category, with permission overwrites granting access only to the opener and configured support roles.

### Web dashboard flow (preferred for non-trivial config)

The dashboard handles everything the slash commands do, plus things slash commands can't (multi-line embed copy, live preview, role multi-select, ticket browsing). Operators sign in with Discord, pick a server they manage, and CRUD panels / ticket types / settings from forms with sessionStorage-backed state.

### Permission Model

| Action      | Authorization                                    |
| ----------- | ------------------------------------------------ |
| Open ticket | Any member with view access to the panel channel |
| Close       | Opener **or** support role                       |
| Claim       | Support role                                     |
| Reopen      | Support role                                     |
| Delete      | Manage Guild permission                          |

Permission checks happen at the service layer. Discord's per-viewer button visibility cannot be controlled — buttons are visible to anyone with channel access (same constraint that affects MEE6, Tickety, etc.). Unauthorized clicks are rejected with an ephemeral error.

---

## White-label Branding

Every user-visible string and visual element is sourced from environment variables or i18n templates. To rebrand for a new community:

```env
BOT_NAME=Acme
BOT_BRAND_COLOR="#5865F2"
BOT_ICON_URL=https://cdn.example.com/acme.png
BOT_FOOTER_TEXT="Powered by Acme Engineering"
BOT_SUPPORT_URL=https://acme.com/support
BOT_LOCALE=en
```

Set these in **both** `apps/bot/.env` and `apps/dashboard/.env`. Restart the stack. Embeds, buttons, error messages, dashboard chrome — everything reflects the new brand.

Hardcoded community names anywhere in the codebase are caught by an ESLint rule (`no-restricted-syntax`) and a CI grep gate.

---

## Environment Variables

See [`apps/bot/.env.example`](apps/bot/.env.example) and [`apps/dashboard/.env.example`](apps/dashboard/.env.example) for annotated templates.

### Shared between the two services

| Variable                                                                                               | Description                                                                                      |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`                                                                                         | Same connection string in both. Compose-internal hostname is `postgres`.                         |
| `INTERNAL_API_TOKEN`                                                                                   | Shared bearer token for bot ↔ dashboard. **Must match.** Generate once: `openssl rand -hex 32`. |
| `BOT_NAME` / `BOT_BRAND_COLOR` / `BOT_ICON_URL` / `BOT_FOOTER_TEXT` / `BOT_SUPPORT_URL` / `BOT_LOCALE` | Mirror in both `.env` files.                                                                     |

### Bot-only

| Variable                     | Description                                                              |
| ---------------------------- | ------------------------------------------------------------------------ |
| `DISCORD_TOKEN`              | Bot token from Developer Portal → Bot → Reset Token                      |
| `DISCORD_APP_ID`             | Application ID (snowflake)                                               |
| `DISCORD_DEV_GUILD_ID`       | Optional — register slash commands to a single guild for instant updates |
| `TICKET_ARCHIVE_CATEGORY_ID` | Closed-ticket destination (also settable via `/setup`)                   |
| `BOT_LOG_CHANNEL_ID`         | Audit-log channel (also settable via `/setup`)                           |

### Dashboard-only

| Variable                | Description                                                       |
| ----------------------- | ----------------------------------------------------------------- |
| `DISCORD_CLIENT_ID`     | Same value as `DISCORD_APP_ID`                                    |
| `DISCORD_CLIENT_SECRET` | OAuth2 client secret                                              |
| `NEXTAUTH_URL`          | `http://localhost:3200` (dev) or `https://your-subdomain` (prod)  |
| `NEXTAUTH_SECRET`       | Generate once: `openssl rand -base64 32`                          |
| `BOT_INTERNAL_URL`      | `http://bot:3000` (compose) or `http://localhost:3100` (host dev) |

### Secrets

This repository is **public**. Never commit real tokens, passwords, or DSNs. The `.gitignore`, lefthook pre-commit (`gitleaks`), and CI all enforce this. If a token is ever exposed in git history, rotate it immediately at the Discord Developer Portal.

---

## Development

### Scripts

```bash
# Development
pnpm dev                              # bot watch
pnpm --filter @hearth/dashboard dev   # dashboard watch

# Build
pnpm build                            # all packages

# Code quality
pnpm typecheck
pnpm lint
pnpm format

# Tests
pnpm test                             # unit tests, fast
pnpm --filter @hearth/bot test:integration   # testcontainers Postgres 16

# Cleanup
pnpm clean
```

### Commit Convention

[Conventional Commits](https://www.conventionalcommits.org/), enforced by commitlint via lefthook commit-msg hook:

```
feat(tickets): add /transfer subcommand
fix(panel): handle missing role on type add
chore(deps): bump discord.js to 14.27.0
docs(core): document operator setup flow
test(tickets): cover concurrent open race
```

Co-author tags (`Co-Authored-By: ...`) are not used in this repository.

---

## Testing

```bash
# All unit tests
pnpm test

# With coverage thresholds enforced (≥85% lines, ≥75% branches)
pnpm test:coverage

# Bot integration suite — Postgres 16 via testcontainers (~30s)
pnpm --filter @hearth/bot test:integration
```

### Strategy

| Layer                                        | Approach                                                                                                                               |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `tickets-core/` and other `*-core/` packages | PGlite (in-memory Postgres) replays the full migration chain + `FakeDiscordGateway` satisfying the composite port. 100% deterministic. |
| `bot/`                                       | FakeGateway for service flows. Internal-api routes tested with mocked context. Pure helpers (e.g. `reactionDiff`) tested standalone.   |
| `dashboard/`                                 | Server Actions tested with mocked db + botClient.                                                                                      |
| Integration                                  | Real Postgres via `@testcontainers/postgresql`. Migrations applied per-suite. Verifies advisory lock + partial unique index.           |
| Discord interactions                         | Out of scope for automated tests. Verified manually in dev guilds before each PR.                                                      |

---

## Deployment

The supported deployment target is a **GCP Compute Engine VM** (or any host with Docker + Compose v2) sitting behind nginx + certbot. Bot, dashboard, and Postgres run in one compose stack. No registry — the VM builds images directly.

The full deploy flow lives in [`docs/runbook/02-dashboard-deploy.md`](docs/runbook/02-dashboard-deploy.md). Pre-deploy gate-by-gate checklist: [`docs/runbook/03-pre-deploy-checklist.md`](docs/runbook/03-pre-deploy-checklist.md).

### One-time VM setup

```bash
sudo apt install docker.io docker-compose-v2 git nginx certbot python3-certbot-nginx
sudo usermod -aG docker $USER && newgrp docker

git clone https://github.com/GrapeInTheTree/hearth.git /opt/hearth
cd /opt/hearth

cp apps/bot/.env.example apps/bot/.env
cp apps/dashboard/.env.example apps/dashboard/.env
# Fill in real values. INTERNAL_API_TOKEN must be identical in both.

sudo cp infra/nginx/dashboard.conf.example \
        /etc/nginx/sites-available/dashboard.example.com
sudo $EDITOR /etc/nginx/sites-available/dashboard.example.com   # set server_name
sudo ln -s /etc/nginx/sites-available/dashboard.example.com /etc/nginx/sites-enabled/
sudo certbot --nginx -d dashboard.example.com
```

### First boot

```bash
cd /opt/hearth/infra
./deploy.sh
# = git pull --ff-only
#   sanity-check INTERNAL_API_TOKEN matches across the two .env files
#   docker compose build bot dashboard
#   docker compose up -d
#   docker compose logs --tail=20 bot dashboard
```

The bot's entrypoint calls `runMigrations(env.DATABASE_URL)` before starting, so schema drift is impossible — boot fails loudly if migrations can't apply. Slash commands auto-register on first connect (idHints persisted afterward to avoid re-registration churn).

### Subsequent deploys

```bash
./infra/deploy.sh
```

That's it. Pulls latest, rebuilds, restarts.

### Operations

```bash
docker compose ps                    # health status
docker compose logs -f bot dashboard # stream logs

# Bot internal endpoints (token from .env)
curl http://localhost:3100/healthz
curl -H 'Authorization: Bearer <TOKEN>' \
     http://localhost:3100/internal/guilds/list?ids=<id>

# Dashboard health (returns the login page)
curl -I http://localhost:3200/login
```

### Hardening notes

- Bot, dashboard, and Postgres all bind to `127.0.0.1` only. No public ingress is exposed by compose.
- The bot uses **outbound** WebSocket to Discord Gateway. No domain or TLS termination is needed for the bot itself — only the dashboard's subdomain matters.
- `.env` files should be `chmod 600` and owned by `root` in production.
- Postgres data persists in a named volume (`pgdata`). Snapshots via `docker compose exec postgres pg_dump` cron + GCS upload — wire this up before user-visible state accumulates.

---

## Quality Gates

Every pull request must pass:

| Gate              | Tool                                                       |
| ----------------- | ---------------------------------------------------------- |
| Type safety       | TypeScript 5.8 strict, zero errors                         |
| Lint              | ESLint 9 flat config, zero warnings                        |
| Format            | Prettier 3                                                 |
| Unit tests        | Vitest, ≥85% line coverage on `tickets-core`               |
| Integration tests | Vitest + testcontainers (gated `RUN_INTEGRATION=1`)        |
| Commit format     | Conventional Commits via commitlint                        |
| Versioning        | Changesets entry per user-visible change                   |
| Secret scan       | gitleaks (lefthook pre-commit)                             |
| Build             | `docker compose build` succeeds for both bot and dashboard |
| White-label       | grep gate for hardcoded community names outside `i18n/`    |

Hooks are installed automatically by `pnpm install` (`prepare: lefthook install`).

---

## License

UNLICENSED — private project. The source is public for transparency only; redistribution is not permitted.

---

<p align="center">
  <sub>Built to outlast the platform churn.</sub>
</p>
