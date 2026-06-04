import { compareTweetId } from '../../src/lib/tweetId.js';
import type { TweetItem, XFeedSource } from '../../src/ports/xFeedSource.js';

// Scripted XFeedSource double. Holds a fixed set of posts and mimics a
// real source's server-side `since_id` filter: fetchSince(null) returns a
// recent window (all configured items), fetchSince(id) returns only items
// strictly newer than id. resolveUser maps handles via a configured table
// (or returns null to exercise the unresolved path) and counts calls so
// tests can assert the id is resolved exactly once.

export interface FakeXFeedSourceOptions {
  /** handle → userId. Missing handle → resolveUser returns null. */
  readonly users?: Readonly<Record<string, string>>;
  /** All posts the account has, any order. */
  readonly items?: readonly TweetItem[];
}

export class FakeXFeedSource implements XFeedSource {
  public readonly name = 'fake';
  public resolveCalls = 0;
  public fetchCalls = 0;
  private readonly users: Record<string, string>;
  private items: TweetItem[];

  public constructor(options: FakeXFeedSourceOptions = {}) {
    this.users = { ...(options.users ?? {}) };
    this.items = [...(options.items ?? [])];
  }

  /** Replace the scripted post set mid-test (e.g. simulate a new tweet
   *  arriving between two polls). */
  public setItems(items: readonly TweetItem[]): void {
    this.items = [...items];
  }

  public resolveUser(handle: string): Promise<{ userId: string } | null> {
    this.resolveCalls += 1;
    const userId = this.users[handle];
    return Promise.resolve(userId === undefined ? null : { userId });
  }

  public fetchSince(_userId: string, sinceId: string | null): Promise<readonly TweetItem[]> {
    this.fetchCalls += 1;
    if (sinceId === null) return Promise.resolve([...this.items]);
    return Promise.resolve(this.items.filter((i) => compareTweetId(i.id, sinceId) > 0));
  }
}

/** Build a TweetItem with sane defaults for tests. */
export function tweet(
  id: string,
  kind: TweetItem['kind'] = 'original',
  handle = 'KayenFinance',
): TweetItem {
  return {
    id,
    url: `https://x.com/${handle}/status/${id}`,
    kind,
    createdAt: new Date(Number(BigInt(id) % 1_000_000_000n)),
  };
}
