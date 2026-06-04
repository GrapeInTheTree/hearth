import { NullXFeedSource, type PollLogger, type XFeedSource } from '@hearth/x-watcher-core';

import type { Env } from '../config/env.js';

// Builds the XFeedSource the poller reads from, chosen by X_FEED_SOURCE.
//
// Only the null (disabled) source ships today — the feature is wired
// end-to-end but mirrors nothing until a real backend is available. When
// an X API key (or an RSS feed) arrives, plugging it in is intentionally
// tiny and local:
//
//   1. Add the implementation under src/services/sources/ (or in
//      @hearth/x-watcher-core if it's vendor-pure), e.g. XApiV2Source.
//   2. Add a value to the X_FEED_SOURCE enum in config/env.ts (+ any
//      token env it needs).
//   3. Add a branch here:
//        if (env.X_FEED_SOURCE === 'xapi')
//          return new XApiV2Source({ bearerToken: env.X_API_BEARER_TOKEN }, logger);
//
// The XFeedSource port keeps the poller, service, schema, and dashboard
// completely vendor-agnostic, so steps 1–3 are the entire integration.
export function createXFeedSource(env: Env, logger: PollLogger): XFeedSource {
  logger.info(`x-watcher: feed source = "${env.X_FEED_SOURCE}" (post mirroring disabled)`);
  return new NullXFeedSource();
}
