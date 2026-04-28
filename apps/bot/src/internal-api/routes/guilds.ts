import type { ServerResponse } from 'node:http';

import { ChannelType } from 'discord.js';

import { sendError, sendJson } from '../json.js';
import type { InternalApiContext } from '../types.js';

// Shapes are defined here (rather than in tickets-core/schemas.ts) because
// they're response payloads from the bot's local Discord cache, not domain
// inputs. The dashboard imports a TypeScript type via @hearth/dashboard's
// own client wrapper.

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
 * GET /internal/guilds/list?ids=g1,g2,g3
 *
 * Returns the subset of supplied guild IDs where the bot is also a member,
 * with the guild's name + icon hash for the dashboard's guild picker. The
 * dashboard side already filtered the user's OAuth `guilds` payload down to
 * those where the user holds Manage Guild — this endpoint just intersects
 * with the bot's membership.
 */
export function handleGuildsList(ctx: InternalApiContext, url: URL, res: ServerResponse): void {
  const idsParam = url.searchParams.get('ids');
  if (idsParam === null || idsParam === '') {
    sendJson(res, 200, []);
    return;
  }
  const ids = new Set(
    idsParam
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s !== ''),
  );
  const summaries: GuildSummary[] = [];
  for (const id of ids) {
    const guild = ctx.client.guilds.cache.get(id);
    if (guild === undefined) continue;
    summaries.push({ id: guild.id, name: guild.name, iconHash: guild.icon });
  }
  sendJson(res, 200, summaries);
}

/**
 * GET /internal/guilds/:guildId/resources
 *
 * Returns the channel/category/role lists the dashboard needs to populate
 * pickers (active-category, support-roles, etc.). Read straight from the
 * discord.js cache — the bot maintains it via Gateway events and the cache
 * is authoritative for everything operators can see.
 */
export function handleGuildResources(
  ctx: InternalApiContext,
  guildId: string,
  res: ServerResponse,
): void {
  const guild = ctx.client.guilds.cache.get(guildId);
  if (guild === undefined) {
    sendError(res, 'not_found', `Guild ${guildId} not found or bot is not a member`);
    return;
  }

  const channels: GuildResources['channels'][number][] = [];
  const categories: GuildResources['categories'][number][] = [];
  for (const channel of guild.channels.cache.values()) {
    if (channel.type === ChannelType.GuildCategory) {
      categories.push({ id: channel.id, name: channel.name });
    } else if (channel.type === ChannelType.GuildText) {
      channels.push({ id: channel.id, name: channel.name, type: 'text' });
    } else if (channel.type === ChannelType.GuildAnnouncement) {
      channels.push({ id: channel.id, name: channel.name, type: 'announcement' });
    }
  }

  // discord.js v14.26 deprecated `Role.color` in favor of `Role.colors`
  // (rich color schemes for boosters etc). The dashboard only renders a
  // single accent dot per role, so we read the primary color from the new
  // shape with a fallback to 0 (no color).
  const roles = guild.roles.cache
    .filter((r) => !r.managed && r.id !== guild.id)
    .map((r) => ({
      id: r.id,
      name: r.name,
      color: r.colors.primaryColor,
      managed: r.managed,
    }));

  const payload: GuildResources = {
    channels: channels.sort((a, b) => a.name.localeCompare(b.name)),
    categories: categories.sort((a, b) => a.name.localeCompare(b.name)),
    roles: roles.sort((a, b) => a.name.localeCompare(b.name)),
  };
  sendJson(res, 200, payload);
}
