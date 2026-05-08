import type { IncomingMessage, ServerResponse } from 'node:http';

import { sendError, sendJson } from '../json.js';
import type { InternalApiContext } from '../types.js';

// Resolves a batch of Discord IDs to display names. Used by the
// dashboard to show readable usernames / channel names / role names
// instead of raw snowflakes.
//
// Strategy:
//   - Channels: cache-only. discord.js maintains channel cache for the
//     lifetime of the gateway connection — REST fetch isn't worth the
//     latency for a list view. If a channel is missing (deleted), the
//     dashboard falls back to the ID.
//   - Roles: per-guild cache. We need the guild context (roles aren't
//     in a global cache) so the dashboard sends roleIds grouped by
//     guildId. Same cache-only pattern as channels.
//   - Users: cache first, then REST fallback. The user cache is sweept
//     aggressively (especially after restarts), so a list of 50 ticket
//     openers will frequently have cache misses. discord.js's
//     `users.fetch(id)` hits Discord's GET /users/:id which is rate-
//     limited per-route at ~50/s — easily within budget for a 50-id
//     batch. Successful fetches are cached, so the next page load is
//     instant.

export interface ResolveRequest {
  readonly userIds?: readonly string[];
  readonly channelIds?: readonly string[];
  /** Role IDs scoped to a specific guild — roles are guild-local. */
  readonly guildId?: string;
  readonly roleIds?: readonly string[];
}

export interface ResolveResponse {
  readonly users: Record<string, { username: string; avatarHash: string | null }>;
  readonly channels: Record<string, { name: string }>;
  /** Role display name + Discord int color (0 = no color). */
  readonly roles: Record<string, { name: string; color: number }>;
}

export async function handleResolve(
  ctx: InternalApiContext,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const body = await readJson(req);
  if (body === null) {
    sendError(res, 'validation', 'request body must be valid JSON');
    return;
  }
  const userIds = Array.isArray(body.userIds)
    ? body.userIds.filter((s): s is string => typeof s === 'string')
    : [];
  const channelIds = Array.isArray(body.channelIds)
    ? body.channelIds.filter((s): s is string => typeof s === 'string')
    : [];
  const roleIds = Array.isArray(body.roleIds)
    ? body.roleIds.filter((s): s is string => typeof s === 'string')
    : [];
  const guildId = typeof body.guildId === 'string' ? body.guildId : undefined;

  const users: ResolveResponse['users'] = {};
  await Promise.all(
    userIds.map(async (id) => {
      const cached = ctx.client.users.cache.get(id);
      if (cached !== undefined) {
        users[id] = { username: cached.username, avatarHash: cached.avatar };
        return;
      }
      try {
        const fetched = await ctx.client.users.fetch(id);
        users[id] = { username: fetched.username, avatarHash: fetched.avatar };
      } catch {
        // Unknown user (deleted account, bad ID), Discord 404 / 5xx, or
        // rate limit. Omit the entry — dashboard falls back to the raw ID.
      }
    }),
  );
  const channels: ResolveResponse['channels'] = {};
  for (const id of channelIds) {
    const channel = ctx.client.channels.cache.get(id);
    if (channel !== undefined && 'name' in channel && typeof channel.name === 'string') {
      channels[id] = { name: channel.name };
    }
  }
  const roles: ResolveResponse['roles'] = {};
  if (guildId !== undefined && roleIds.length > 0) {
    const guild = ctx.client.guilds.cache.get(guildId);
    if (guild !== undefined) {
      for (const id of roleIds) {
        const role = guild.roles.cache.get(id);
        if (role !== undefined) {
          // Discord introduced multi-colored roles in 2026; we only
          // surface the primary color since the dashboard renders a
          // single dot indicator. Server admins still see the full
          // palette in Discord itself.
          roles[id] = { name: role.name, color: role.colors.primaryColor };
        }
      }
    }
  }
  sendJson(res, 200, { users, channels, roles });
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        if (raw.trim() === '') {
          resolve({});
          return;
        }
        const parsed = JSON.parse(raw) as unknown;
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          resolve(null);
          return;
        }
        resolve(parsed as Record<string, unknown>);
      } catch {
        resolve(null);
      }
    });
    req.on('error', () => {
      resolve(null);
    });
  });
}
