import { DiscordApiError, NotFoundError } from '@hearth/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { _resetBotClientBreaker, callBot } from '@/lib/botClient';

interface FakeFetchResponse {
  status: number;
  ok: boolean;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}

function makeResponse(status: number, body: unknown): FakeFetchResponse {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

describe('callBot', () => {
  beforeEach(() => {
    _resetBotClientBreaker();
  });
  afterEach(() => {
    _resetBotClientBreaker();
  });

  it('returns ok(body) on a 200 response', async () => {
    const fetchMock = vi.fn(async () => makeResponse(200, [{ id: 'g1' }]));
    const result = await callBot<{ id: string }[]>(
      { path: '/internal/guilds/list' },
      fetchMock as unknown as typeof fetch,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual([{ id: 'g1' }]);
    }
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('sends Authorization: Bearer <token>', async () => {
    let capturedHeaders: HeadersInit | undefined;
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      capturedHeaders = init.headers;
      return makeResponse(200, []);
    });
    await callBot({ path: '/x' }, fetchMock as unknown as typeof fetch);
    const headers = capturedHeaders as Record<string, string> | undefined;
    expect(headers?.Authorization).toMatch(/^Bearer /);
  });

  it('returns NotFoundError for 404', async () => {
    const fetchMock = vi.fn(async () => makeResponse(404, 'panel not found'));
    const result = await callBot(
      { path: '/internal/panels/missing/render' },
      fetchMock as unknown as typeof fetch,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(NotFoundError);
    }
  });

  it('returns DiscordApiError for 5xx', async () => {
    const fetchMock = vi.fn(async () => makeResponse(503, 'down'));
    const result = await callBot({ path: '/x' }, fetchMock as unknown as typeof fetch);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(DiscordApiError);
    }
  });

  it('returns DiscordApiError on fetch rejection', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    const result = await callBot({ path: '/x' }, fetchMock as unknown as typeof fetch);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(DiscordApiError);
      expect(result.error.message).toMatch(/unreachable/);
    }
  });

  it('opens the breaker after 5 consecutive failures', async () => {
    const fetchMock = vi.fn(async () => makeResponse(503, ''));
    for (let i = 0; i < 5; i += 1) {
      await callBot({ path: '/x' }, fetchMock as unknown as typeof fetch);
    }
    // Sixth call should fast-fail without invoking fetch.
    const result = await callBot({ path: '/x' }, fetchMock as unknown as typeof fetch);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/circuit breaker/);
    // fetch was called 5 times, not 6.
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('breaker closes after the cooldown', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () => makeResponse(503, ''))
      .mockImplementationOnce(async () => makeResponse(503, ''))
      .mockImplementationOnce(async () => makeResponse(503, ''))
      .mockImplementationOnce(async () => makeResponse(503, ''))
      .mockImplementationOnce(async () => makeResponse(503, ''))
      .mockImplementationOnce(async () => makeResponse(200, { ok: true }));
    let now = 1_000_000;
    const nowFn = (): number => now;
    for (let i = 0; i < 5; i += 1) {
      await callBot({ path: '/x' }, fetchMock as unknown as typeof fetch, nowFn);
    }
    // Advance past breaker cooldown (30s).
    now += 31_000;
    const result = await callBot({ path: '/x' }, fetchMock as unknown as typeof fetch, nowFn);
    expect(result.ok).toBe(true);
  });
});
