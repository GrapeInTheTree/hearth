import { describe, expect, it } from 'vitest';

import { XApiV2Source } from '../../src/services/sources/xApiV2Source.js';

// Unit tests for the official X API v2 source. No network, no real token —
// fetch is injected and returns canned payloads matching the documented
// v2 response shapes (docs.x.com, 2026-06). Verifies handle resolution,
// the since_id / max_results request, post-kind classification, URL
// building from includes.users, the data-absent empty case, and HTTP
// error propagation.

interface FakeCall {
  url: string;
  headers: Record<string, string>;
}

function fakeFetch(
  body: unknown,
  opts: { ok?: boolean; status?: number; calls?: FakeCall[] } = {},
): typeof fetch {
  const fn = (input: unknown, init?: { headers?: Record<string, string> }): Promise<Response> => {
    opts.calls?.push({ url: String(input), headers: init?.headers ?? {} });
    return Promise.resolve({
      ok: opts.ok ?? true,
      status: opts.status ?? 200,
      json: () => Promise.resolve(body),
    } as unknown as Response);
  };
  return fn as unknown as typeof fetch;
}

const TOKEN = 'test-bearer-token';

describe('XApiV2Source.resolveUser', () => {
  it('returns the numeric id on success', async () => {
    const calls: FakeCall[] = [];
    const src = new XApiV2Source({
      bearerToken: TOKEN,
      fetchFn: fakeFetch({ data: { id: '2244994945', username: 'KayenFinance' } }, { calls }),
    });
    const result = await src.resolveUser('KayenFinance');
    expect(result).toEqual({ userId: '2244994945' });
    // hits the by-username endpoint with the bearer header
    expect(calls[0]?.url).toContain('/2/users/by/username/KayenFinance');
    expect(calls[0]?.headers['Authorization']).toBe(`Bearer ${TOKEN}`);
  });

  it('returns null for a missing/suspended handle (200 + errors, no data)', async () => {
    const src = new XApiV2Source({
      bearerToken: TOKEN,
      fetchFn: fakeFetch({ errors: [{ title: 'Not Found Error' }] }),
    });
    expect(await src.resolveUser('ghost')).toBeNull();
  });

  it('throws on an HTTP error (e.g. 401 bad token)', async () => {
    const src = new XApiV2Source({
      bearerToken: TOKEN,
      fetchFn: fakeFetch({}, { ok: false, status: 401 }),
    });
    await expect(src.resolveUser('x')).rejects.toThrow(/401/);
  });
});

describe('XApiV2Source.fetchSince', () => {
  const timeline = {
    data: [
      { id: '101', author_id: '42', created_at: '2026-06-04T00:00:00.000Z', text: 'plain' },
      {
        id: '102',
        author_id: '42',
        created_at: '2026-06-04T00:01:00.000Z',
        text: 'quote',
        referenced_tweets: [{ type: 'quoted', id: '900' }],
      },
      {
        id: '103',
        author_id: '42',
        created_at: '2026-06-04T00:02:00.000Z',
        text: 'rt',
        referenced_tweets: [{ type: 'retweeted', id: '901' }],
      },
      {
        id: '104',
        author_id: '42',
        created_at: '2026-06-04T00:03:00.000Z',
        text: 'reply',
        referenced_tweets: [{ type: 'replied_to', id: '902' }],
      },
    ],
    includes: { users: [{ id: '42', username: 'KayenFinance' }] },
    meta: { result_count: 4 },
  };

  it('classifies kinds and builds canonical URLs from includes.users', async () => {
    const src = new XApiV2Source({ bearerToken: TOKEN, fetchFn: fakeFetch(timeline) });
    const items = await src.fetchSince('42', '100');
    expect(items.map((i) => [i.id, i.kind])).toEqual([
      ['101', 'original'],
      ['102', 'quote'],
      ['103', 'retweet'],
      ['104', 'reply'],
    ]);
    expect(items[0]?.url).toBe('https://x.com/KayenFinance/status/101');
    expect(items[1]?.createdAt.toISOString()).toBe('2026-06-04T00:01:00.000Z');
  });

  it('passes since_id and a full page size on a normal poll', async () => {
    const calls: FakeCall[] = [];
    const src = new XApiV2Source({ bearerToken: TOKEN, fetchFn: fakeFetch(timeline, { calls }) });
    await src.fetchSince('42', '100');
    const url = calls[0]?.url ?? '';
    expect(url).toContain('/2/users/42/tweets');
    expect(url).toContain('since_id=100');
    expect(url).toContain('max_results=100');
    expect(url).toContain('referenced_tweets');
    expect(url).toContain('expansions=author_id');
  });

  it('uses the minimum page size on the seed poll (since_id null)', async () => {
    const calls: FakeCall[] = [];
    const src = new XApiV2Source({ bearerToken: TOKEN, fetchFn: fakeFetch(timeline, { calls }) });
    await src.fetchSince('42', null);
    const url = calls[0]?.url ?? '';
    expect(url).toContain('max_results=5');
    expect(url).not.toContain('since_id');
  });

  it('returns [] when data is absent (nothing newer than since_id)', async () => {
    const src = new XApiV2Source({
      bearerToken: TOKEN,
      fetchFn: fakeFetch({ meta: { result_count: 0 } }),
    });
    expect(await src.fetchSince('42', '999')).toEqual([]);
  });

  it('falls back to the handle-less URL when the author is not in includes', async () => {
    const src = new XApiV2Source({
      bearerToken: TOKEN,
      fetchFn: fakeFetch({ data: [{ id: '200', author_id: '42' }], meta: { result_count: 1 } }),
    });
    const items = await src.fetchSince('42', '1');
    expect(items[0]?.url).toBe('https://x.com/i/status/200');
  });

  it('throws on an HTTP error', async () => {
    const src = new XApiV2Source({
      bearerToken: TOKEN,
      fetchFn: fakeFetch({}, { ok: false, status: 429 }),
    });
    await expect(src.fetchSince('42', '1')).rejects.toThrow(/429/);
  });
});
