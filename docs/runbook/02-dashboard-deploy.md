# Dashboard deploy runbook

Single-VM deploy for the bot + dashboard + postgres stack. Mirrors the
existing chiliz-api.fanx.xyz pattern: nginx + certbot terminate TLS on
the host, Docker Compose runs the workload behind it, and every service
binds to localhost only.

## Prerequisites on the VM

- Docker + Docker Compose v2 (`docker compose version` >= 2.20)
- Nginx + certbot (the operator's existing setup)
- This repo cloned to a stable path (e.g. `/opt/discord-bot`)
- A subdomain pointing at the VM's external IP (e.g. `bot-dashboard.fanx.xyz`)
- A Discord application with two redirect URIs allowlisted:
  - `http://localhost:3200/api/auth/callback/discord` (dev)
  - `https://bot-dashboard.fanx.xyz/api/auth/callback/discord` (prod)

## One-time setup

### 1. Generate the shared internal API token

```bash
openssl rand -hex 32
```

Paste the **same value** into both `apps/bot/.env` (`INTERNAL_API_TOKEN=`)
and `apps/dashboard/.env` (`INTERNAL_API_TOKEN=`). `infra/deploy.sh`
checks they match — a mismatch causes every dashboard mutation to 401.

### 2. Generate the NextAuth signing secret

```bash
openssl rand -base64 32
```

Goes into `apps/dashboard/.env` (`NEXTAUTH_SECRET=`). Rotate by
regenerating + restarting the dashboard container; existing sessions
expire and operators sign in again.

### 3. Fill in `.env` files

```bash
cd /opt/discord-bot
cp apps/bot/.env.example apps/bot/.env
cp apps/dashboard/.env.example apps/dashboard/.env
$EDITOR apps/bot/.env
$EDITOR apps/dashboard/.env
```

Required values are documented in each `.env.example`. Both files share:

- `DATABASE_URL` — same connection string in both
- `INTERNAL_API_TOKEN` — same value in both
- `BOT_NAME` / `BOT_BRAND_COLOR` / etc — branding mirrored

The bot owns `DISCORD_TOKEN`/`DISCORD_APP_ID`; the dashboard owns
`DISCORD_CLIENT_ID`/`DISCORD_CLIENT_SECRET`/`NEXTAUTH_*`.

### 4. nginx site config

```bash
sudo cp infra/nginx/bot-dashboard.fanx.xyz.conf.example \
        /etc/nginx/sites-available/bot-dashboard.fanx.xyz
sudo $EDITOR /etc/nginx/sites-available/bot-dashboard.fanx.xyz   # adjust server_name
sudo ln -s /etc/nginx/sites-available/bot-dashboard.fanx.xyz \
           /etc/nginx/sites-enabled/
sudo certbot --nginx -d bot-dashboard.fanx.xyz
sudo nginx -t && sudo systemctl reload nginx
```

certbot rewrites the file in place to add `ssl_certificate*` directives.
Cert renewal runs via certbot's systemd timer; nothing to do here.

### 5. First boot

```bash
cd /opt/discord-bot/infra
./deploy.sh
```

The script: pulls latest, sanity-checks the two `.env` files, builds
both images, brings up postgres + bot + dashboard, prints the last 20
log lines from each. Bot's entrypoint runs `prisma migrate deploy`
before starting, so schema drift is impossible.

## Subsequent deploys

```bash
cd /opt/discord-bot/infra
./deploy.sh
```

Same flow. To restart only one service: `docker compose restart dashboard`.

## Operations

```bash
# Status
docker compose -f infra/docker-compose.yml ps

# Stream logs
docker compose -f infra/docker-compose.yml logs -f bot dashboard

# Bot internal endpoints (for debugging — token from .env)
curl http://localhost:3100/healthz
curl -H 'Authorization: Bearer <TOKEN>' http://localhost:3100/internal/guilds/list?ids=<id>

# Dashboard health (returns the login page)
curl -I http://localhost:3200/login

# Full recreate (required after DISCORD_DEV_GUILD_ID changes — Sapphire's
# slash registration cache otherwise skips the new guild)
docker compose -f infra/docker-compose.yml down bot dashboard
docker compose -f infra/docker-compose.yml up -d bot dashboard
```

## Port plan

Every service binds `127.0.0.1` only — public access is the operator's
nginx job.

| Service      | Host port | Env override      | Purpose                                   |
| ------------ | --------- | ----------------- | ----------------------------------------- |
| Bot internal | 3100      | `BOT_HEALTH_PORT` | `/healthz` + `/internal/*`                |
| Dashboard    | 3200      | `DASHBOARD_PORT`  | nginx upstream                            |
| Postgres     | 5433      | `POSTGRES_PORT`   | dev access (5433 avoids native pg's 5432) |

Override via the host environment:

```bash
DASHBOARD_PORT=4000 docker compose -f infra/docker-compose.yml up -d
```

## Hardening

- Postgres data lives in the `pgdata` named volume. Take periodic dumps:
  `docker compose exec postgres pg_dump -U bot discord_bot > backup-$(date +%F).sql`
  Wire this into a cron + GCS upload before user-visible state accumulates.
- `.env` files should be `chmod 600 root:root` in production. Phase 4+
  consider migrating to GCP Secret Manager.
- Both bots share one Postgres instance. The bot does the migration and
  is therefore the schema owner; the dashboard reads/writes through the
  same client and is migration-free. **Never** run `prisma migrate dev`
  on production — only `prisma migrate deploy` (which the bot's
  entrypoint already does on boot).

## Troubleshooting

**Dashboard 401s on every action** — `INTERNAL_API_TOKEN` mismatch
between `apps/bot/.env` and `apps/dashboard/.env`. Fix and restart both.

**Discord OAuth redirect_uri error** — the redirect URI you signed in
with isn't in the Developer Portal's allowlist. Add the prod URL.

**Bot logs but dashboard says "bot offline"** — `BOT_INTERNAL_URL` in
the dashboard's env points at the wrong host. Inside compose it must be
`http://bot:3000` (service name); on the host (dev) it's
`http://localhost:3100`.

**`prisma migrate deploy` fails** — schema drift. Bot won't boot if
migrations don't apply cleanly. Restore from a recent dump or roll
forward by writing a new migration locally and re-deploying.
