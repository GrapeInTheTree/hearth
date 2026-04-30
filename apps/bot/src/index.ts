import '@sapphire/plugin-logger/register';

import { dbDrizzle } from '@hearth/database';
import { runMigrations } from '@hearth/database/migrate';
import { container as diContainer } from '@sapphire/framework';
import {
  ApplicationCommandRegistries,
  RegisterBehavior,
  SapphireClient,
} from '@sapphire/framework';
import { GatewayIntentBits, Partials } from 'discord.js';

// Load env + container side effects FIRST so any subsequent import can use them.
import { branding } from './config/branding.js';
import { env } from './config/env.js';
import { attachServices } from './container.js';
import { startInternalApi } from './internal-api/server.js';
import { sapphireLogLevel } from './lib/logger.js';
import { DjsDiscordGateway } from './services/ports/discordGateway.djs.js';

// Register slash commands to dev guild for instant updates if configured.
if (env.DISCORD_DEV_GUILD_ID !== undefined) {
  ApplicationCommandRegistries.setDefaultGuildIds([env.DISCORD_DEV_GUILD_ID]);
}
ApplicationCommandRegistries.setDefaultBehaviorWhenNotIdentical(RegisterBehavior.Overwrite);
// TODO(phase-1.1): persist application command ids to .command-hints.json
// and seed each command's `idHints` so re-registration is skipped when the
// command shape hasn't changed. Today every boot does a full Discord API
// upsert which costs ~1–3s and counts toward rate limits. Deferred because
// it's pure perf — correctness is unaffected.

const client = new SapphireClient({
  loadMessageCommandListeners: false,
  intents: [
    GatewayIntentBits.Guilds,
    // Privileged intent — must be enabled in the Developer Portal. Needed for
    // resolving member display names when posting "{user} closed the ticket."
    // style system messages and for permission overwrites tied to member role
    // caches.
    GatewayIntentBits.GuildMembers,
    // GatewayIntentBits.MessageContent  ← Phase 1.1 transcript export only
  ],
  partials: [Partials.GuildMember, Partials.Channel],
  logger: { level: sapphireLogLevel },
});

// Wire services that need the live Client into the Sapphire DI container.
// Pieces (commands/listeners/interactions) read services from `container.services`.
attachServices(new DjsDiscordGateway(client));

// Graceful shutdown on SIGTERM/SIGINT (Docker stop sends SIGTERM).
// Order: stop accepting Discord events → flush DB connections → exit. We swallow
// shutdown errors since the process is exiting anyway, but log them for postmortem.
let shuttingDown = false;
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    client.logger.warn(`Received ${signal} — shutting down gracefully`);
    void (async () => {
      try {
        await client.destroy();
      } catch (err) {
        client.logger.error('Error while destroying Discord client', err);
      }
      // Drizzle's NodePgDatabase has no top-level disconnect — the pg.Pool
      // owns the sockets and exits with the process. Bot is short-lived
      // for SIGINT/SIGTERM, so we let the OS reap connections; if we ever
      // need an explicit close (e.g. for Cloud Run cold-start), expose
      // the Pool from `client.drizzle.ts` and call `pool.end()` here.
      process.exit(0);
    })();
  });
}

try {
  // Apply unapplied DB migrations before opening the gateway connection.
  // On a fresh DB this creates everything; on a Prisma-managed prod DB
  // the adoption path inside runMigrations marks 0000_init as already
  // applied so no schema change occurs. Either way, the schema matches
  // the canonical Drizzle definition before any service queries run.
  await runMigrations(env.DATABASE_URL);
  client.logger.info('✅ Database migrations applied');

  await client.login(env.DISCORD_TOKEN);
  await startInternalApi({
    port: env.PORT,
    token: env.INTERNAL_API_TOKEN,
    context: {
      client,
      db: dbDrizzle,
      panel: diContainer.services.panel,
      branding,
      isReady: () => client.isReady(),
    },
  });
  client.logger.info(`🚀 ${branding.name} bootstrap complete (env=${env.NODE_ENV})`);
} catch (err) {
  // Last-resort logger before process exits — Sapphire logger may not be ready.
  // eslint-disable-next-line no-console
  console.error('💥 Fatal bootstrap error:', err);
  process.exit(1);
}
