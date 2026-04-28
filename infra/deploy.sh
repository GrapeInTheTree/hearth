#!/usr/bin/env bash
# Deploy Hearth (bot + dashboard) on a VM (or any host running Docker + docker compose).
# Builds bot + dashboard images locally from their Dockerfiles — no
# registry required.
#
# Usage on VM (from infra/ directory):
#   ./deploy.sh
#
# Prerequisites on VM:
#   - docker + docker compose v2
#   - this repo cloned
#   - apps/bot/.env and apps/dashboard/.env filled in (copy from .env.example)
#   - INTERNAL_API_TOKEN set to the SAME value in both .env files

set -euo pipefail

cd "$(dirname "$0")"

if [ ! -f ../apps/bot/.env ]; then
  echo "❌ ../apps/bot/.env not found — copy apps/bot/.env.example and fill in"
  exit 1
fi
if [ ! -f ../apps/dashboard/.env ]; then
  echo "❌ ../apps/dashboard/.env not found — copy apps/dashboard/.env.example and fill in"
  exit 1
fi

# Sanity-check that INTERNAL_API_TOKEN matches across the two .env files.
# A mismatch silently breaks every dashboard mutation later, so catch it now.
bot_token="$(grep -E '^INTERNAL_API_TOKEN=' ../apps/bot/.env | head -1 | cut -d= -f2-)"
dash_token="$(grep -E '^INTERNAL_API_TOKEN=' ../apps/dashboard/.env | head -1 | cut -d= -f2-)"
if [ -n "$bot_token" ] && [ "$bot_token" != "$dash_token" ]; then
  echo "❌ INTERNAL_API_TOKEN differs between apps/bot/.env and apps/dashboard/.env"
  echo "   The dashboard's bot calls will all 401. Set the same value in both."
  exit 1
fi

echo "🔄 Pulling latest source..."
git pull --ff-only

echo "🐳 Building images locally..."
docker compose build bot dashboard

echo "🔁 Starting services (postgres + bot + dashboard)..."
docker compose up -d

echo "⏳ Waiting 15s for startup..."
sleep 15

echo "📋 Bot logs:"
docker compose logs --tail=20 bot
echo ""
echo "📋 Dashboard logs:"
docker compose logs --tail=20 dashboard

echo ""
echo "✅ Deploy complete"
echo "   Bot healthz:  curl http://localhost:${BOT_HEALTH_PORT:-3100}/healthz"
echo "   Dashboard:    curl http://localhost:${DASHBOARD_PORT:-3200}/login"
echo "   Public URL:   set in nginx site config (see infra/nginx/dashboard.conf.example)"
