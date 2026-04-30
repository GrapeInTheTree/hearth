import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import * as schema from './schema/index.js';

// Drizzle client over node-postgres. Mirrors the lazy-Proxy pattern from
// the legacy Prisma client (./client.ts) — module evaluation must be safe
// during Next.js's `next build` page-metadata pass, which happens before
// any runtime DATABASE_URL is in place. The Proxy defers Pool construction
// until first member access; missing DATABASE_URL crashes loudly there
// instead of at import time.

type Schema = typeof schema;
export type DbDrizzle = NodePgDatabase<Schema>;

// Drizzle 0.45 doesn't export a top-level Tx alias; derive it from the
// transaction callback parameter so call sites can type their helpers
// without reaching into deep import paths. `incrementTicketCounter(tx, …)`
// uses this.
export type DbDrizzleTx = Parameters<Parameters<DbDrizzle['transaction']>[0]>[0];

const globalForDrizzle = globalThis as unknown as {
  __hearthDbDrizzle: DbDrizzle | undefined;
  __hearthDbDrizzlePool: Pool | undefined;
};

function createClient(): DbDrizzle {
  const url = process.env['DATABASE_URL'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL must be set before instantiating the Drizzle client');
  }
  const pool = new Pool({ connectionString: url });
  const client = drizzle(pool, { schema });
  if (process.env['NODE_ENV'] !== 'production') {
    globalForDrizzle.__hearthDbDrizzle = client;
    globalForDrizzle.__hearthDbDrizzlePool = pool;
  }
  return client;
}

function resolveClient(): DbDrizzle {
  return globalForDrizzle.__hearthDbDrizzle ?? createClient();
}

export const dbDrizzle: DbDrizzle = new Proxy({} as DbDrizzle, {
  get(_target, prop, receiver) {
    return Reflect.get(resolveClient(), prop, receiver) as unknown;
  },
  has(_target, prop) {
    return Reflect.has(resolveClient(), prop);
  },
  ownKeys() {
    return Reflect.ownKeys(resolveClient());
  },
  getOwnPropertyDescriptor(_target, prop) {
    return Reflect.getOwnPropertyDescriptor(resolveClient(), prop);
  },
});
