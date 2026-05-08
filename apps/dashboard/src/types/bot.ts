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

/**
 * Response shape for `POST /internal/resolve` — batch ID → display-name
 * lookup. Keys are the requested IDs. Missing keys mean the bot couldn't
 * resolve (cache miss + REST 404 / rate limit / role not in guild) — the
 * caller should fall back to showing the raw ID.
 *
 * `roles` requires `guildId` in the request body since roles are guild-
 * scoped (no global cache).
 */
export interface ResolveResponse {
  readonly users: Record<string, { username: string; avatarHash: string | null }>;
  readonly channels: Record<string, { name: string }>;
  readonly roles: Record<string, { name: string; color: number }>;
}
