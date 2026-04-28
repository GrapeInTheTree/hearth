import type { ServerResponse } from 'node:http';

import { DiscordApiError, NotFoundError } from '@hearth/shared';

import { sendError, sendJson } from '../json.js';
import type { InternalApiContext } from '../types.js';

/**
 * POST /internal/panels/:panelId/render
 *
 * Idempotent re-render of the panel's Discord message from the current DB
 * state. Used by dashboard Server Actions after they mutate panel/type rows.
 *
 * 200 `{ messageId, recreated }` on success.
 * 404 when the panel id doesn't exist.
 * 503 when the bot's Discord API call fails (transient — caller should retry).
 */
export async function handlePanelRender(
  ctx: InternalApiContext,
  panelId: string,
  res: ServerResponse,
): Promise<void> {
  try {
    const result = await ctx.panel.renderPanel(panelId);
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
 * DELETE /internal/panels/:panelId
 *
 * Remove the Discord message (best-effort) and the DB row. Cascades to types.
 * Tickets reference panels via FK RESTRICT; if any exist, the underlying
 * Prisma error surfaces as a 500 (caller should delete tickets first).
 */
export async function handlePanelDelete(
  ctx: InternalApiContext,
  panelId: string,
  res: ServerResponse,
): Promise<void> {
  try {
    const result = await ctx.panel.deletePanel(panelId);
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
