import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { type DbDrizzle, schema } from '@hearth/database';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';

// PGlite-backed in-memory Postgres — same approach as
// @hearth/verification-core/tests/helpers/testDb. We replay all three
// migrations (0000_init, 0001_verification, 0002_reaction_roles) so the
// reaction-roles tables exist alongside the ticket + verification schema —
// the relational query API resolves over the full namespace.

const __dirname = dirname(fileURLToPath(import.meta.url));

const MIGRATION_PATHS = [
  resolve(__dirname, '../../../database/drizzle/0000_init.sql'),
  resolve(__dirname, '../../../database/drizzle/0001_verification.sql'),
  resolve(__dirname, '../../../database/drizzle/0002_self_roles.sql'),
  resolve(__dirname, '../../../database/drizzle/0003_self_roles_audit_retention.sql'),
  resolve(__dirname, '../../../database/drizzle/0004_role_picker.sql'),
  resolve(__dirname, '../../../database/drizzle/0005_reaction_roles_rename.sql'),
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
