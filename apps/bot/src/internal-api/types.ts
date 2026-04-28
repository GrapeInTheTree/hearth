import type { DbClient } from '@hearth/database';
import type { PanelService } from '@hearth/tickets-core';
import type { Client } from 'discord.js';

import type { Branding } from '../config/branding.js';

/**
 * Dependencies injected into every internal-api route handler. The server
 * gathers these at startup time (after the SapphireClient + DI container are
 * wired) and passes the same object to every handler — so handlers stay
 * unit-testable in isolation by passing a fake context.
 */
export interface InternalApiContext {
  readonly client: Client;
  readonly db: DbClient;
  readonly panel: PanelService;
  readonly branding: Branding;
  /** Returns true when the bot's gateway connection is OPEN (used by /healthz). */
  readonly isReady: () => boolean;
}

/** Standard error envelope. HTTP status maps from `code`. */
export type ApiErrorCode =
  | 'unauthorized'
  | 'not_found'
  | 'conflict'
  | 'validation'
  | 'discord_unavailable'
  | 'internal';

export interface ApiError {
  readonly error: ApiErrorCode;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export const STATUS_FOR_CODE: Record<ApiErrorCode, number> = {
  unauthorized: 401,
  not_found: 404,
  conflict: 409,
  validation: 422,
  discord_unavailable: 503,
  internal: 500,
};
