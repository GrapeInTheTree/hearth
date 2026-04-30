import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { type DbDrizzle, schema } from '@hearth/database';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';

// PGlite is Postgres compiled to WASM — fully in-memory, ~30ms cold start,
// real Postgres semantics including FK enforcement, partial unique indexes,
// JSONB type parsing, and transaction rollback. Replaces the legacy
// `createFakeDb()` helper which mocked Prisma's surface in pure JS.
//
// Why pglite over a hand-rolled fake:
//  - Real DB invariants: FK violations surface as 23503 errors, not silent.
//  - Real partial-unique semantics: `ticket_open_dedupe (...) WHERE status
//    IN ('open','claimed')` enforced by Postgres itself, not bespoke JS.
//  - Real transaction rollback: tx.insert + thrown error rolls back cleanly.
//  - One-third the maintenance — no chainable interpreter, no operator
//    object parsing.
//
// Why not testcontainers for unit tests: Postgres 16 container takes 5-15s
// to spin up per worker; with 8 service test files Vitest watch mode
// becomes unusable. Integration tests (apps/bot/tests/integration/) keep
// using testcontainers for production-equivalent DB.
//
// Limitation: pglite does not implement `pg_advisory_xact_lock`. PR-7's
// advisory-locked openTicket needs to fall back to testcontainers for the
// concurrent-open test specifically (a one-off file gate).

const __dirname = dirname(fileURLToPath(import.meta.url));

// Resolve the migration SQL relative to this file so the helper works
// regardless of cwd. The path crosses the workspace boundary into
// @hearth/database — acceptable because it's test infra only.
const MIGRATION_PATH = resolve(__dirname, '../../../database/drizzle/0000_init.sql');

let cachedSql: string | undefined;

function loadInitSql(): string {
  if (cachedSql !== undefined) return cachedSql;
  const raw = readFileSync(MIGRATION_PATH, 'utf-8');
  // drizzle-kit emits `--> statement-breakpoint` between DDL statements.
  // PGlite's `exec` runs the whole script as one batch (it splits on
  // semicolons internally), so strip the markers to get a clean SQL blob.
  cachedSql = raw.replace(/--> statement-breakpoint\n?/g, '');
  return cachedSql;
}

export interface TestDb {
  readonly db: DbDrizzle;
  readonly close: () => Promise<void>;
}

/**
 * Spin a fresh in-memory Postgres via PGlite and apply the canonical
 * 0000_init.sql migration. Returns a Drizzle client typed as `DbDrizzle`
 * (the cast is safe — both drivers implement the same query API; only
 * the underlying transport differs).
 */
export async function createTestDb(): Promise<TestDb> {
  const pg = new PGlite();
  // Wait for PGlite to finish bootstrapping before issuing DDL.
  await pg.waitReady;
  await pg.exec(loadInitSql());
  const drizzleClient = drizzlePglite(pg, { schema });
  return {
    db: drizzleClient as unknown as DbDrizzle,
    close: async () => {
      await pg.close();
    },
  };
}
