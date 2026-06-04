import { XWatcherEventStatus } from '@hearth/database';

import type { TweetItem } from '../ports/xFeedSource.js';

// Pure post-classification: given one post and a watcher's toggles,
// decide whether to mirror it and — if not — which skip status to record.
// This is the single place the include/exclude rules live, so the rules
// are trivially unit-testable in isolation from the I/O of polling.
//
// Rules:
//   retweet  → always skipped (product spec; no toggle)
//   reply    → skipped unless includeReplies
//   quote    → skipped unless includeQuotes (mirrored by default)
//   original → always mirrored

export type PostDecision =
  | { readonly post: true }
  | {
      readonly post: false;
      readonly status:
        | typeof XWatcherEventStatus.skippedRetweet
        | typeof XWatcherEventStatus.skippedReply
        | typeof XWatcherEventStatus.skippedQuote;
    };

export interface ClassifyOptions {
  readonly includeQuotes: boolean;
  readonly includeReplies: boolean;
}

export function classifyPost(item: TweetItem, opts: ClassifyOptions): PostDecision {
  switch (item.kind) {
    case 'retweet':
      return { post: false, status: XWatcherEventStatus.skippedRetweet };
    case 'reply':
      return opts.includeReplies
        ? { post: true }
        : { post: false, status: XWatcherEventStatus.skippedReply };
    case 'quote':
      return opts.includeQuotes
        ? { post: true }
        : { post: false, status: XWatcherEventStatus.skippedQuote };
    case 'original':
      return { post: true };
  }
}
