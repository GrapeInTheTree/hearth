// X (Twitter) → Discord post-mirror domain logic. Imported by both
// apps/bot (poller + slash + internal API) and apps/dashboard (Server
// Actions). Reuses the DiscordGateway port from @hearth/tickets-core
// (single seam for the bot's Discord integration). Never imports the
// discord.js runtime and — by design — never names a feed vendor: all
// vendor specifics live behind the XFeedSource port.

export {
  XWatcherService,
  type XWatcherInput,
  type XWatcherEditInput,
  type RecordEventInput,
} from './xWatcherService.js';

export type { TweetItem, TweetKind, XFeedSource } from './ports/xFeedSource.js';
export { NullXFeedSource } from './sources/nullXFeedSource.js';

export {
  pollWatcherOnce,
  type PollLogger,
  type PollSummary,
  type PollWatcherDeps,
} from './lib/pollWatcher.js';
export { classifyPost, type ClassifyOptions, type PostDecision } from './lib/classifyPost.js';
export { compareTweetId, isNewerThan } from './lib/tweetId.js';

export {
  XWatcherInputSchema,
  XWatcherEditSchema,
  type XWatcherInput as XWatcherInputType,
  type XWatcherEdit,
} from './schemas.js';

export { xWatcher, type XWatcherBundle } from './i18n/index.js';
