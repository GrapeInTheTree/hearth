// Type-only mirror of the bot's /internal API responses. The bot defines
// the canonical shapes in apps/bot/src/internal-api/routes/*.ts; we
// duplicate the types here rather than importing because the bot's
// route handlers also import discord.js (which we don't want in the
// dashboard's bundle).

export interface GuildSummary {
  readonly id: string;
  readonly name: string;
  readonly iconHash: string | null;
}

export interface GuildResources {
  readonly channels: readonly { id: string; name: string; type: 'text' | 'announcement' }[];
  readonly categories: readonly { id: string; name: string }[];
  readonly roles: readonly { id: string; name: string; color: number; managed: boolean }[];
}
