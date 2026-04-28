import { DiscordApiError, NotFoundError, type Result, err, ok } from '@hearth/shared';

import { env } from './env';

// Typed HTTP client to the bot's internal API. Used exclusively by Server
// Actions and server components. Centralizes timeout, auth header, and a
// minimal circuit breaker so a flapping bot doesn't tank dashboard
// response times.
//
// Timeout: 3 seconds per request (Discord cache reads are <50ms locally;
// anything slower is a Discord API outage which we should fail fast).
//
// Circuit breaker: 5 consecutive failures opens the breaker for 30s. While
// open, calls fast-fail with DiscordApiError so Server Actions can surface
// the "Discord re-render queued — retry" banner without waiting on a fresh
// timeout each click.

const REQUEST_TIMEOUT_MS = 3_000;
const FAILURE_THRESHOLD = 5;
const OPEN_DURATION_MS = 30_000;

interface BreakerState {
  consecutiveFailures: number;
  openUntil: number; // epoch ms; 0 = closed
}

const state: BreakerState = { consecutiveFailures: 0, openUntil: 0 };

function isBreakerOpen(now: number): boolean {
  return state.openUntil > now;
}

function recordSuccess(): void {
  state.consecutiveFailures = 0;
  state.openUntil = 0;
}

function recordFailure(now: number): void {
  state.consecutiveFailures += 1;
  if (state.consecutiveFailures >= FAILURE_THRESHOLD) {
    state.openUntil = now + OPEN_DURATION_MS;
  }
}

/** Visible for tests. Resets the breaker so each test starts clean. */
export function _resetBotClientBreaker(): void {
  state.consecutiveFailures = 0;
  state.openUntil = 0;
}

export interface BotClientRequest {
  readonly path: string;
  readonly method?: 'GET' | 'POST' | 'DELETE';
  readonly body?: Readonly<Record<string, unknown>>;
  /** Override the global timeout. Tests use shorter values. */
  readonly timeoutMs?: number;
}

export type BotClientError = DiscordApiError | NotFoundError;

/**
 * Call the bot's internal API. Returns `Result<T, BotClientError>`:
 *  - `ok(body)`              — 2xx response, JSON body
 *  - `err(NotFoundError)`    — 404 with the bot's error envelope
 *  - `err(DiscordApiError)`  — anything else (network failure, breaker
 *                              open, 5xx, timeout, malformed JSON)
 */
export async function callBot<T = unknown>(
  request: BotClientRequest,
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<Result<T, BotClientError>> {
  const currentTime = now();
  if (isBreakerOpen(currentTime)) {
    return err(new DiscordApiError('bot client circuit breaker is open'));
  }

  const url = `${env.BOT_INTERNAL_URL}${request.path}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, request.timeoutMs ?? REQUEST_TIMEOUT_MS);

  try {
    const init: RequestInit = {
      method: request.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${env.INTERNAL_API_TOKEN}`,
        ...(request.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      signal: controller.signal,
      ...(request.body !== undefined ? { body: JSON.stringify(request.body) } : {}),
    };
    const response = await fetchImpl(url, init);

    if (response.status === 404) {
      const detail = await response.text().catch(() => '');
      recordFailure(currentTime);
      return err(
        new NotFoundError(`bot 404: ${request.path}${detail !== '' ? ` — ${detail}` : ''}`),
      );
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      recordFailure(currentTime);
      return err(
        new DiscordApiError(
          `bot ${String(response.status)}: ${request.path}${detail !== '' ? ` — ${detail}` : ''}`,
          response.status,
        ),
      );
    }

    const json = (await response.json()) as T;
    recordSuccess();
    return ok(json);
  } catch (e) {
    recordFailure(currentTime);
    if (e instanceof Error && e.name === 'AbortError') {
      return err(
        new DiscordApiError(
          `bot timeout after ${String(request.timeoutMs ?? REQUEST_TIMEOUT_MS)}ms: ${request.path}`,
        ),
      );
    }
    return err(new DiscordApiError(`bot unreachable: ${request.path} — ${String(e)}`));
  } finally {
    clearTimeout(timeoutId);
  }
}
