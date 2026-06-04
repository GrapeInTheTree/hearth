import type { PollLogger, TweetItem, TweetKind, XFeedSource } from '@hearth/x-watcher-core';

// XFeedSource backed by the OFFICIAL X (Twitter) API v2.
//
// Lives in apps/bot (not @hearth/x-watcher-core) because it's vendor-
// specific — the core stays vendor-neutral behind the XFeedSource port.
// Uses app-only auth (Bearer token) over the global fetch (Node 22), so
// no SDK dependency. Reading public posts needs no user-context OAuth.
//
// Contract (verified against docs.x.com v2, 2026-06):
//   - GET /2/users/by/username/:username
//       → 200 { data: { id, ... } }  OR  200 { errors: [...] } (not found)
//   - GET /2/users/:id/tweets?since_id=&max_results=&tweet.fields=created_at,
//         referenced_tweets&expansions=author_id&user.fields=username
//       → { data?: [...], includes?: { users: [...] }, meta: {...} }
//       `data` is ABSENT (not []) when nothing is newer than since_id.
//   - referenced_tweets[].type ∈ { 'retweeted', 'quoted', 'replied_to' };
//     absent ⇒ original. Multiple possible → priority retweet > quote > reply.
//   - since_id is exclusive (strictly newer). Bearer rate limit 10k/15min
//     per app — far above our needs; billing is per post read (separate).

const API_BASE = 'https://api.x.com';

// Cheapest seed: on the first poll (since_id absent) the poller only needs
// the newest id to set the cursor, so pull the API minimum (5). On a normal
// poll we allow a full page to catch up after downtime.
const SEED_MAX_RESULTS = 5;
const PAGE_MAX_RESULTS = 100;

type FetchFn = typeof fetch;

interface XApiV2SourceOptions {
  readonly bearerToken: string;
  /** Injectable for tests; defaults to the global fetch. */
  readonly fetchFn?: FetchFn;
  readonly logger?: PollLogger;
}

interface XUserResponse {
  readonly data?: { readonly id: string; readonly username?: string };
  readonly errors?: readonly unknown[];
}

interface XTweet {
  readonly id: string;
  readonly author_id?: string;
  readonly created_at?: string;
  readonly referenced_tweets?: readonly { readonly type: string; readonly id: string }[];
}

interface XTimelineResponse {
  readonly data?: readonly XTweet[];
  readonly includes?: {
    readonly users?: readonly { readonly id: string; readonly username: string }[];
  };
}

export class XApiV2Source implements XFeedSource {
  public readonly name = 'xapi';
  private readonly bearerToken: string;
  private readonly fetchFn: FetchFn;
  private readonly logger: PollLogger | undefined;

  public constructor(options: XApiV2SourceOptions) {
    this.bearerToken = options.bearerToken;
    this.fetchFn = options.fetchFn ?? fetch;
    this.logger = options.logger;
  }

  public async resolveUser(handle: string): Promise<{ userId: string } | null> {
    const body = await this.getJson<XUserResponse>(
      `/2/users/by/username/${encodeURIComponent(handle)}`,
    );
    // v2 returns 200 + { errors } (no data) for a missing/suspended handle.
    if (body.data?.id === undefined) {
      this.logger?.warn('x-watcher(xapi): handle did not resolve', { handle });
      return null;
    }
    return { userId: body.data.id };
  }

  public async fetchSince(userId: string, sinceId: string | null): Promise<readonly TweetItem[]> {
    const params = new URLSearchParams({
      max_results: String(sinceId === null ? SEED_MAX_RESULTS : PAGE_MAX_RESULTS),
      'tweet.fields': 'created_at,referenced_tweets',
      expansions: 'author_id',
      'user.fields': 'username',
    });
    if (sinceId !== null) params.set('since_id', sinceId);

    const body = await this.getJson<XTimelineResponse>(
      `/2/users/${userId}/tweets?${String(params)}`,
    );
    if (body.data === undefined || body.data.length === 0) return [];

    // Single-author timeline → the author is the one user in includes.
    const author = body.includes?.users?.find((u) => u.id === body.data?.[0]?.author_id);
    const username = author?.username;

    return body.data.map((t) => toTweetItem(t, username));
  }

  private async getJson<T>(path: string): Promise<T> {
    const res = await this.fetchFn(`${API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${this.bearerToken}` },
    });
    if (!res.ok) {
      // Let the poller's per-watcher try/catch log + skip this tick; a
      // transient 429/5xx simply retries next base tick. Throwing here
      // (rather than returning empty) keeps a real outage visible.
      throw new Error(`X API ${String(res.status)} for ${path}`);
    }
    return (await res.json()) as T;
  }
}

/** Map one API tweet to the vendor-neutral TweetItem. */
function toTweetItem(t: XTweet, username: string | undefined): TweetItem {
  return {
    id: t.id,
    url:
      username !== undefined
        ? `https://x.com/${username}/status/${t.id}`
        : // Handle-less form still resolves/redirects to the canonical URL.
          `https://x.com/i/status/${t.id}`,
    kind: classifyReferences(t.referenced_tweets),
    createdAt: t.created_at !== undefined ? new Date(t.created_at) : new Date(0),
  };
}

/** referenced_tweets → TweetKind. None ⇒ original. Priority on multiples:
 *  retweet (dominant container) > quote > reply. */
function classifyReferences(refs: readonly { readonly type: string }[] | undefined): TweetKind {
  if (refs === undefined || refs.length === 0) return 'original';
  const types = new Set(refs.map((r) => r.type));
  if (types.has('retweeted')) return 'retweet';
  if (types.has('quoted')) return 'quote';
  if (types.has('replied_to')) return 'reply';
  return 'original';
}
