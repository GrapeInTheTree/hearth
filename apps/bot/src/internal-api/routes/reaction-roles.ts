import type { ServerResponse } from 'node:http';

import { DiscordApiError, NotFoundError } from '@hearth/shared';

import { sendError, sendJson } from '../json.js';
import type { InternalApiContext } from '../types.js';

/**
 * POST /internal/reaction-roles/:panelId/options/:optionId/revoke-holders
 *
 * Best-effort revoke of the option's role from every audit-log-derived
 * holder. Used by the dashboard's "Remove option" modal when the
 * operator opts into role cleanup. The option row is *not* deleted here
 * — the dashboard runs its own DELETE afterwards (so cache revalidation
 * stays under its control). Returns the count of successful revokes so
 * the success toast can name the number ("Removed and revoked from N
 * users").
 */
export async function handleReactionRolesRevokeHolders(
  ctx: InternalApiContext,
  _panelId: string,
  optionId: string,
  res: ServerResponse,
): Promise<void> {
  try {
    const result = await ctx.reactionRoles.revokeRoleFromOptionHolders(optionId);
    if (!result.ok) {
      const code = result.error instanceof NotFoundError ? 'not_found' : 'internal';
      sendError(res, code, result.error.message);
      return;
    }
    sendJson(res, 200, result.value);
  } catch (e) {
    if (e instanceof DiscordApiError) {
      sendError(res, 'discord_unavailable', e.message);
      return;
    }
    throw e;
  }
}

/**
 * POST /internal/reaction-roles/:panelId/render
 *
 * Idempotent re-render of a reaction-roles panel's Discord message + reaction
 * seed. Used by dashboard Server Actions after they mutate the panel or
 * options. Unlike verification's render, there is no publish-readiness
 * guard — empty panels are valid (they post an embed with just the
 * placeholder description, no reactions yet).
 */
export async function handleReactionRolesRender(
  ctx: InternalApiContext,
  panelId: string,
  res: ServerResponse,
): Promise<void> {
  try {
    const result = await ctx.reactionRoles.renderPanel(panelId);
    if (!result.ok) {
      sendError(res, 'not_found', result.error.message);
      return;
    }
    sendJson(res, 200, result.value);
  } catch (e) {
    if (e instanceof DiscordApiError) {
      sendError(res, 'discord_unavailable', e.message);
      return;
    }
    throw e;
  }
}

/**
 * POST /internal/reaction-roles/:panelId/repost
 *
 * Drop the existing message (best-effort) and post a fresh one with new
 * reactions seeded.
 */
export async function handleReactionRolesRepost(
  ctx: InternalApiContext,
  panelId: string,
  res: ServerResponse,
): Promise<void> {
  try {
    const result = await ctx.reactionRoles.repostPanel(panelId);
    if (!result.ok) {
      sendError(res, 'not_found', result.error.message);
      return;
    }
    sendJson(res, 200, result.value);
  } catch (e) {
    if (e instanceof DiscordApiError) {
      sendError(res, 'discord_unavailable', e.message);
      return;
    }
    throw e;
  }
}

/**
 * DELETE /internal/reaction-roles/:panelId
 *
 * Remove the Discord message (best-effort) + DB row. Cascades to options
 * and events via FK. Existing role grants on users stay — operators clean
 * those up via /reactionroles or the dashboard.
 */
export async function handleReactionRolesDelete(
  ctx: InternalApiContext,
  panelId: string,
  res: ServerResponse,
): Promise<void> {
  try {
    const result = await ctx.reactionRoles.deletePanel(panelId);
    if (!result.ok) {
      const code = result.error instanceof NotFoundError ? 'not_found' : 'internal';
      sendError(res, code, result.error.message);
      return;
    }
    sendJson(res, 200, { deleted: true, panelId: result.value.panelId });
  } catch (e) {
    if (e instanceof DiscordApiError) {
      sendError(res, 'discord_unavailable', e.message);
      return;
    }
    throw e;
  }
}
