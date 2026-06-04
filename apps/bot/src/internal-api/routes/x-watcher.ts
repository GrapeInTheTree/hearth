import type { ServerResponse } from 'node:http';

import { sendError, sendJson } from '../json.js';
import type { InternalApiContext } from '../types.js';

/**
 * POST /internal/x-watcher/:watcherId/poll
 *
 * On-demand "Poll now" — runs one watcher's poll immediately instead of
 * waiting for the next interval. The dashboard exposes this as a button so
 * an operator can verify a freshly-created watcher (or force a catch-up)
 * without waiting up to the poll interval.
 *
 * Returns the poll summary (seeded / posted / skipped / failed / cursor).
 * 404 when the watcher doesn't exist. The poll itself never throws past
 * the algorithm — Discord send failures are recorded as send_failed rows,
 * not surfaced as route errors.
 */
export async function handleXWatcherPoll(
  ctx: InternalApiContext,
  watcherId: string,
  res: ServerResponse,
): Promise<void> {
  const summary = await ctx.xWatcherPoller.pollOne(watcherId);
  if (summary === null) {
    sendError(res, 'not_found', 'Watcher not found.');
    return;
  }
  sendJson(res, 200, summary);
}
