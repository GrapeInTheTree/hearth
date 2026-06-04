import { NullXFeedSource, type PollLogger, type XFeedSource } from '@hearth/x-watcher-core';

import type { Env } from '../config/env.js';

import { XApiV2Source } from './sources/xApiV2Source.js';

// Builds the XFeedSource the poller reads from, chosen by X_FEED_SOURCE.
//
// To add another backend (e.g. an RSS reader) the integration is local:
//   1. Add the implementation under src/services/sources/ (or in
//      @hearth/x-watcher-core if it's vendor-pure).
//   2. Add a value to the X_FEED_SOURCE enum in config/env.ts (+ any token).
//   3. Add a branch here.
// The XFeedSource port keeps the poller, service, schema, and dashboard
// vendor-agnostic, so those three steps are the entire integration.
export function createXFeedSource(env: Env, logger: PollLogger): XFeedSource {
  if (env.X_FEED_SOURCE === 'xapi') {
    if (env.X_API_BEARER_TOKEN === undefined) {
      // Misconfig: xapi selected but no token. Don't crash the bot — log
      // loudly and run disabled so tickets/roles/etc. still work.
      logger.error(
        'x-watcher: X_FEED_SOURCE=xapi but X_API_BEARER_TOKEN is unset — mirroring disabled',
      );
      return new NullXFeedSource();
    }
    logger.info('x-watcher: feed source = "xapi" (official X API v2)');
    return new XApiV2Source({ bearerToken: env.X_API_BEARER_TOKEN, logger });
  }
  logger.info(`x-watcher: feed source = "${env.X_FEED_SOURCE}" (post mirroring disabled)`);
  return new NullXFeedSource();
}
