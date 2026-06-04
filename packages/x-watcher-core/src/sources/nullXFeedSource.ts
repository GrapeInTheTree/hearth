import type { TweetItem, XFeedSource } from '../ports/xFeedSource.js';

// The default feed source when no backend is configured (X_FEED_SOURCE
// unset or 'none'). It resolves nothing and returns no posts, so a bot
// booted without an X API key / RSS feed runs cleanly and simply mirrors
// nothing — rather than crashing or spamming errors.
//
// The bot poller special-cases `name === 'none'` to skip the poll loop
// entirely (and log once at startup that watching is disabled), so this
// source's methods are a belt-and-braces safety net, not a hot path.
export class NullXFeedSource implements XFeedSource {
  public readonly name = 'none';

  public resolveUser(): Promise<{ userId: string } | null> {
    return Promise.resolve(null);
  }

  public fetchSince(): Promise<readonly TweetItem[]> {
    return Promise.resolve([]);
  }
}
