import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { type DbDrizzle, schema } from '@hearth/database';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';

// PGlite-backed in-memory Postgres. Same approach as
// @hearth/self-roles-core/tests/helpers/testDb — we replay every
// migration in order so the role-picker tables exist alongside the
// rest of the schema. The relational query API resolves over the full
// namespace.

const __dirname = dirname(fileURLToPath(import.meta.url));

const MIGRATION_PATHS = [
  resolve(__dirname, '../../../database/drizzle/0000_init.sql'),
  resolve(__dirname, '../../../database/drizzle/0001_verification.sql'),
  resolve(__dirname, '../../../database/drizzle/0002_self_roles.sql'),
  resolve(__dirname, '../../../database/drizzle/0003_self_roles_audit_retention.sql'),
  resolve(__dirname, '../../../database/drizzle/0004_role_picker.sql'),
];

let cachedSql: string | undefined;

function loadMigrations(): string {
  if (cachedSql !== undefined) return cachedSql;
  const combined = MIGRATION_PATHS.map((p) => readFileSync(p, 'utf-8')).join('\n');
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
