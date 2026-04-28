# Pre-deploy checklist (dashboard MVP)

Run through this before the first VM deploy. Each item is a smoke gate
that catches a class of misconfiguration. The full deploy flow lives in
[`02-dashboard-deploy.md`](./02-dashboard-deploy.md); this checklist is the
"did I forget anything?" companion.

## DNS + Domain

- [ ] `bot-dashboard.fanx.xyz` (or your chosen subdomain) has an A record
      pointing at the VM's external IP. `dig +short bot-dashboard.fanx.xyz`
      returns the right address.
- [ ] No conflicting nginx site already serves the same hostname.
- [ ] Cert renewal cron / systemd timer for certbot is healthy on the VM
      (`sudo systemctl status certbot.timer`).

## Discord application

- [ ] Bot token from `Bot → Reset Token` saved into `apps/bot/.env`
      (`DISCORD_TOKEN=`). The token is shown once — keep it.
- [ ] Application ID in `apps/bot/.env` (`DISCORD_APP_ID=`) and
      `apps/dashboard/.env` (`DISCORD_CLIENT_ID=`). They're the same value.
- [ ] Client Secret from `OAuth2 → Reset Secret` in `apps/dashboard/.env`
      (`DISCORD_CLIENT_SECRET=`).
- [ ] OAuth2 redirect URIs include both:
  - `http://localhost:3200/api/auth/callback/discord` (dev)
  - `https://bot-dashboard.fanx.xyz/api/auth/callback/discord` (prod)
- [ ] Bot is invited to the target guild with at least the permissions in
      `docs/architecture/`'s invite scope notes (Manage Channels, Manage
      Roles, Send Messages, Embed Links, Use Slash Commands, View Audit
      Log for delete events).
- [ ] `Server Members Intent` is **enabled** under
      `Bot → Privileged Gateway Intents`.

## Secrets

- [ ] `INTERNAL_API_TOKEN` generated once via `openssl rand -hex 32`.
      Same value in **both** `apps/bot/.env` and `apps/dashboard/.env`.
      `infra/deploy.sh` checks this — but easier to fix now than on first
      OAuth round-trip.
- [ ] `NEXTAUTH_SECRET` generated once via `openssl rand -base64 32`.
      In `apps/dashboard/.env` only.
- [ ] `POSTGRES_PASSWORD` set to something stronger than the
      `apps/bot/.env.example` default (`bot`). Same value in both
      `DATABASE_URL` strings.
- [ ] `.env` files are `chmod 600` and owned by the deploy user:
      `sudo chown root:root /opt/hearth/apps/{bot,dashboard}/.env && sudo chmod 600 ...`
- [ ] `git status` shows no `.env` files staged (gitignore covers them,
      but pre-flight check beats post-flight rotation).

## Branding

- [ ] `BOT_NAME`, `BOT_BRAND_COLOR`, `BOT_FOOTER_TEXT`, `BOT_ICON_URL`
      set in **both** `.env` files to identical values. The bot uses
      these in Discord embeds; the dashboard uses them in the chrome.
- [ ] `BOT_LOCALE` set (`en` shipped today; `ko` is a future translation
      file). Mismatch produces wrong copy on one surface.
- [ ] `BOT_BRAND_COLOR` is a hex like `#5865F2`, **quoted** in YAML/env
      (the `#` is otherwise read as a comment).

## Database

- [ ] `DATABASE_URL` points at the compose-internal `postgres` service
      in production (`@postgres:5432`), not `localhost`. Same value in
      both `.env` files.
- [ ] `pgdata` named volume isn't pre-populated with stale data from
      a different schema (rare, but a re-deploy on a recycled VM can
      hit this — drop the volume if so).
- [ ] If migrating from a bot-only stack: take a `pg_dump` first.

## nginx

- [ ] `infra/nginx/bot-dashboard.fanx.xyz.conf.example` copied to
      `/etc/nginx/sites-available/bot-dashboard.fanx.xyz` and the
      `server_name` adjusted.
- [ ] Symlink in `sites-enabled/` (`sudo ln -s ...`).
- [ ] `sudo nginx -t` passes before reload.
- [ ] `sudo certbot --nginx -d bot-dashboard.fanx.xyz` ran successfully.
      certbot rewrites the file in place to insert `ssl_certificate*`
      directives; that's expected.
- [ ] `sudo systemctl reload nginx` after the cert is installed.

## Compose stack

- [ ] `docker compose -f infra/docker-compose.yml ps` shows three
      services healthy: `bot`, `dashboard`, `postgres`.
- [ ] No port conflicts on the VM. Check before `up`:
      `ss -lntp | grep -E ':(3100|3200|5433)\b'` should be empty.
- [ ] Logs show no Prisma migration errors:
      `docker compose logs bot | grep -i 'migrate'`. Bot's entrypoint
      runs `prisma migrate deploy` — schema drift fails loudly.
- [ ] Bot's startup log includes
      `🚀 <BOT_NAME> bootstrap complete (env=production)`.

## Smoke gates

- [ ] `curl http://localhost:3100/healthz` → `200 {"ready":true}`
      (after the bot has finished login — first 5–10s may be 503).
- [ ] `curl -H 'Authorization: Bearer <INTERNAL_API_TOKEN>' http://localhost:3100/internal/guilds/list?ids=<your guild>`
      → returns the guild summary (the bot is a member).
- [ ] `curl -I http://localhost:3200/login` → `200 OK` (returns the login HTML).
- [ ] `https://bot-dashboard.fanx.xyz/login` reachable in a browser,
      shows the brand logo + "Sign in with Discord" button.
- [ ] Click sign-in → Discord OAuth consent screen for **identify guilds** scopes
      (no `bot` / `applications.commands` here — the bot's invite is separate).
- [ ] After consent → land on `/select-guild`. The target guild appears
      in the "managed" section, not "Servers without <BotName>".
- [ ] Click into the guild → `/g/<id>` overview shows correct counts
      (zero panels initially is fine).

## Optional — operator first run

- [ ] `Panels → New panel` → fill channel + title + description + Create
      → panel message appears in the chosen Discord channel within ~2s.
- [ ] `Add ticket type` → fill required fields (label, name, emoji,
      active category, support role) → Discord button appears on the
      panel message in place.
- [ ] In Discord, a non-staff user clicks the type button → ticket
      channel created in the configured active category.
- [ ] Dashboard `Tickets` page shows the new ticket with `open` status.

## Rollback

If anything above fails on first deploy:

```bash
cd /opt/hearth/infra
docker compose down
git log --oneline -5         # last 5 main commits
git checkout <previous good>
./deploy.sh
```

`prisma migrate deploy` is forward-only. If a rollback requires a schema
revert, restore from `pg_dump` taken before the deploy. Document this
clearly in the deploy notes for the team.
