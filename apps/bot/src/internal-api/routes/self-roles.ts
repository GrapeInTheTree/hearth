import type { ServerResponse } from 'node:http';

import { DiscordApiError, NotFoundError } from '@hearth/shared';

import { sendError, sendJson } from '../json.js';
import type { InternalApiContext } from '../types.js';

/**
 * POST /internal/self-roles/:panelId/options/:optionId/revoke-holders
 *
 * Best-effort revoke of the option's role from every audit-log-derived
 * holder. Used by the dashboard's "Remove option" modal when the
 * operator opts into role cleanup. The option row is *not* deleted here
 * — the dashboard runs its own DELETE afterwards (so cache revalidation
 * stays under its control). Returns the count of successful revokes so
 * the success toast can name the number ("Removed and revoked from N
 * users").
 */
export async function handleSelfRolesRevokeHolders(
  ctx: InternalApiContext,
  _panelId: string,
  optionId: string,
  res: ServerResponse,
): Promise<void> {
  try {
    const result = await ctx.selfRoles.revokeRoleFromOptionHolders(optionId);
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
 * POST /internal/self-roles/:panelId/render
 *
 * Idempotent re-render of a self-roles panel's Discord message + reaction
 * seed. Used by dashboard Server Actions after they mutate the panel or
 * options. Unlike verification's render, there is no publish-readiness
 * guard — empty panels are valid (they post an embed with just the
 * placeholder description, no reactions yet).
 */
export async function handleSelfRolesRender(
  ctx: InternalApiContext,
  panelId: string,
  res: ServerResponse,
): Promise<void> {
  try {
    const result = await ctx.selfRoles.renderPanel(panelId);
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
 * POST /internal/self-roles/:panelId/repost
 *
 * Drop the existing message (best-effort) and post a fresh one with new
 * reactions seeded.
 */
export async function handleSelfRolesRepost(
  ctx: InternalApiContext,
  panelId: string,
  res: ServerResponse,
): Promise<void> {
  try {
    const result = await ctx.selfRoles.repostPanel(panelId);
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
 * DELETE /internal/self-roles/:panelId
 *
 * Remove the Discord message (best-effort) + DB row. Cascades to options
 * and events via FK. Existing role grants on users stay — operators clean
 * those up via /selfroles or the dashboard.
 */
export async function handleSelfRolesDelete(
  ctx: InternalApiContext,
  panelId: string,
  res: ServerResponse,
): Promise<void> {
  try {
    const result = await ctx.selfRoles.deletePanel(panelId);
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
