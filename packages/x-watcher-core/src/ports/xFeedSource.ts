// The XFeedSource port — the ONE seam between the watcher's poll
// algorithm and wherever the posts actually come from. Everything above
// this line (service, poll logic, dedupe, classification) is vendor-
// agnostic; everything below (official X API client, RSS.app reader,
// RSSHub reader) is an interchangeable implementation.
//
// Swapping the backend is an `X_FEED_SOURCE` env change plus a different
// implementation of this two-method interface — no service, schema, or
// dashboard change. The implementation's sole job is to normalise its
// vendor's wire format into the `TweetItem` shape below; all the messy
// vendor-specific bits (typed `referenced_tweets` from the API, or
// `RT @`-prefix string-matching from an RSS feed) are confined there.

/** What kind of post this is. The poll classifier keys its skip rules
 *  off this single field, so the SOURCE owns getting it right:
 *    - 'original' — a normal authored post (always mirrored)
 *    - 'quote'    — a quote post (mirrored unless includeQuotes=false)
 *    - 'retweet'  — a plain retweet (NEVER mirrored — product spec)
 *    - 'reply'    — a reply (mirrored only if includeReplies=true)
 *  The official X API expresses this via `referenced_tweets[].type`
 *  ('quoted' / 'retweeted' / 'replied_to'); an RSS source infers it from
 *  the item's prefix/structure. Either way the rest of the system only
 *  ever sees this enum. */
export type TweetKind = 'original' | 'quote' | 'retweet' | 'reply';

/** A single normalised post. `id` is X's own numeric status id — the
 *  vendor-independent dedupe key and ordering key (snowflakes are
 *  monotonic, compared as BigInt). `url` is the exact bare link the bot
 *  posts to Discord. */
export interface TweetItem {
  readonly id: string;
  readonly url: string;
  readonly kind: TweetKind;
  readonly createdAt: Date;
}

export interface XFeedSource {
  /** A short identifier for the active backend ('xapi' / 'rssapp' /
   *  'rsshub' / 'none'), surfaced in logs so operators can see which
   *  source is live. The poller skips the whole loop when this is the
   *  null source ('none'). */
  readonly name: string;

  /** Resolve an @handle to X's stable numeric user id. Called once per
   *  watcher (the result is persisted on the row) and again only if the
   *  id was never resolved. Returns null when the handle can't be
   *  resolved (typo, suspended account, or — for the null source — no
   *  backend configured); the poller records nothing and tries again
   *  next tick. */
  resolveUser(handle: string): Promise<{ userId: string } | null>;

  /** Fetch posts strictly NEWER than `sinceId` for the given user,
   *  newest-or-oldest order doesn't matter (the poller re-sorts by id).
   *  When `sinceId` is null the source may return a small recent window —
   *  the poller treats the first poll as a silent seed and posts none of
   *  them. Implementations should cap the page size; a watched account
   *  posting normally yields a handful of items per poll. */
  fetchSince(userId: string, sinceId: string | null): Promise<readonly TweetItem[]>;
}
