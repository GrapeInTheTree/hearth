import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { type DbDrizzle, schema } from '@hearth/database';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';

// PGlite-backed in-memory Postgres — same approach as
// @hearth/tickets-core/tests/helpers/testDb. We replay both the base
// 0000_init.sql and 0001_verification.sql migrations so the verification
// tables exist alongside the ticket tables (some tests touch panel + role
// references that live in the original schema).

const __dirname = dirname(fileURLToPath(import.meta.url));

const MIGRATION_PATHS = [
  resolve(__dirname, '../../../database/drizzle/0000_init.sql'),
  resolve(__dirname, '../../../database/drizzle/0001_verification.sql'),
];

let cachedSql: string | undefined;

function loadMigrations(): string {
  if (cachedSql !== undefined) return cachedSql;
  const combined = MIGRATION_PATHS.map((p) => readFileSync(p, 'utf-8')).join('\n');
  // drizzle-kit emits `--> statement-breakpoint` between DDL statements.
  // PGlite's `exec` runs the whole script as one batch (it splits on
  // semicolons internally), so strip the markers to get a clean SQL blob.
  cachedSql = combined.replace(/--> statement-breakpoint\n?/g, '');
  return cachedSql;
}

export interface TestDb {
  readonly db: DbDrizzle;
  readonly close: () => Promise<void>;
}

export async function createTestDb(): Promise<TestDb> {
  const pg = new PGlite();
  await pg.waitReady;
  await pg.exec(loadMigrations());
  const drizzleClient = drizzlePglite(pg, { schema });
  return {
    db: drizzleClient as unknown as DbDrizzle,
    close: async () => {
      await pg.close();
    },
  };
}
