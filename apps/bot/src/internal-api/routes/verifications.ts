import type { ServerResponse } from 'node:http';

import { ConflictError, DiscordApiError, NotFoundError } from '@hearth/shared';

import { sendError, sendJson } from '../json.js';
import type { InternalApiContext } from '../types.js';

/**
 * POST /internal/verifications/:panelId/render
 *
 * Idempotent re-render of a verification panel's Discord message from the
 * current DB state. Used by dashboard Server Actions after they mutate the
 * panel/options. Rejects with 409 when the panel has options but no correct
 * option chosen — publishing then would silently drop every click.
 */
export async function handleVerificationRender(
  ctx: InternalApiContext,
  panelId: string,
  res: ServerResponse,
): Promise<void> {
  try {
    const result = await ctx.verification.renderPanel(panelId);
    if (!result.ok) {
      const code = result.error instanceof ConflictError ? 'conflict' : 'not_found';
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
 * POST /internal/verifications/:panelId/repost
 *
 * Drop the existing message (best-effort) and post a fresh one. Same
 * publish-readiness guard as render.
 */
export async function handleVerificationRepost(
  ctx: InternalApiContext,
  panelId: string,
  res: ServerResponse,
): Promise<void> {
  try {
    const result = await ctx.verification.repostPanel(panelId);
    if (!result.ok) {
      const code = result.error instanceof ConflictError ? 'conflict' : 'not_found';
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
 * DELETE /internal/verifications/:panelId
 *
 * Remove the Discord message (best-effort) + DB row. Cascades to options
 * and events via FK.
 */
export async function handleVerificationDelete(
  ctx: InternalApiContext,
  panelId: string,
  res: ServerResponse,
): Promise<void> {
  try {
    const result = await ctx.verification.deletePanel(panelId);
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
