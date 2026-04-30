import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { type DbDrizzle, schema } from '@hearth/database';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';

// PGlite + Drizzle test infra for Server Action tests. The dashboard's
// `dbDrizzle` is a lazy Proxy that resolves from
// `globalThis.__hearthDbDrizzle` in non-production env (HMR safety).
// Tests pre-populate that slot with a pglite-backed Drizzle instance, so
// when the action code does `import { dbDrizzle } from '@hearth/database'`
// and calls a query method, the Proxy resolves to our test DB without any
// vi.mock dance. Real DB semantics: FK enforcement, partial unique
// indexes, JSONB type parsers, transaction rollback — same as services.

const __dirname = dirname(fileURLToPath(import.meta.url));

const MIGRATION_PATH = resolve(__dirname, '../../../../packages/database/drizzle/0000_init.sql');

let cachedSql: string | undefined;

function loadInitSql(): string {
  if (cachedSql !== undefined) return cachedSql;
  const raw = readFileSync(MIGRATION_PATH, 'utf-8');
  cachedSql = raw.replace(/--> statement-breakpoint\n?/g, '');
  return cachedSql;
}

interface DrizzleGlobal {
  __hearthDbDrizzle?: DbDrizzle;
  __hearthDbDrizzlePool?: unknown;
}

export interface DashboardTestDb {
  readonly db: DbDrizzle;
  readonly close: () => Promise<void>;
}

/**
 * Spin a fresh PGlite, apply 0000_init.sql, and inject the resulting
 * Drizzle client into `globalThis.__hearthDbDrizzle`. Subsequent reads
 * of `dbDrizzle` (via the lazy Proxy in client.drizzle.ts) resolve to
 * this client. Always call `close()` in afterEach to avoid global state
 * bleed between tests.
 */
export async function setupTestDb(): Promise<DashboardTestDb> {
  const pg = new PGlite();
  await pg.waitReady;
  await pg.exec(loadInitSql());
  const drizzleClient = drizzlePglite(pg, { schema });
  const typedClient = drizzleClient as unknown as DbDrizzle;

  const g = globalThis as unknown as DrizzleGlobal;
  g.__hearthDbDrizzle = typedClient;

  return {
    db: typedClient,
    close: async () => {
      g.__hearthDbDrizzle = undefined;
      await pg.close();
    },
  };
}
