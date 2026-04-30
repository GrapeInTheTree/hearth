import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

// Drizzle's migrator replays unapplied SQL files from `migrationsFolder`
// against the `__drizzle_migrations` tracking table. Forward-only — no
// rollback, no `migrate dev` interactive flow. The bot calls this once
// at boot before constructing the SapphireClient; if it fails, the bot
// process exits 1 and the operator's `restart: unless-stopped` policy
// surfaces the failure in the docker logs.
//
// Prod adoption path: this is the first migrator run against a Postgres
// that was previously managed by `prisma migrate deploy`. The DB already
// has all 5 tables, the partial unique index, the FKs, etc. — but no
// `__drizzle_migrations` table. Running `0000_init.sql` would `CREATE
// TABLE` against existing tables and fail. So before invoking the
// migrator we pre-seed `__drizzle_migrations` with `0000_init`'s hash
// so Drizzle's "is this already applied?" check returns true and skips
// the file. Fresh CI/test containers (no Panel table) get the normal
// path: `__drizzle_migrations` doesn't exist, the migrator creates it
// and runs 0000_init from scratch.

const __dirname = dirname(fileURLToPath(import.meta.url));

// `migrate.ts` is bundled into `dist/` alongside `index.js`. Migrations
// ship as an adjacent `drizzle/` folder (Dockerfile copies it). Resolve
// relative to this module so cwd doesn't matter.
function resolveMigrationsFolder(): string {
  // dist/migrate.js sits at packages/database/dist/migrate.js;
  // migrations live at packages/database/drizzle/.
  return resolve(__dirname, '../drizzle');
}

/** Drizzle hashes migration SQL with sha256 of the FILE CONTENT (raw). */
function hashSql(sqlPath: string): string {
  const sql = readFileSync(sqlPath, 'utf-8');
  return createHash('sha256').update(sql).digest('hex');
}

/**
 * If the schema tables already exist (Prisma-managed prod) but the
 * Drizzle tracking table is missing, create the tracking table and
 * insert a row marking 0000_init as already applied. Idempotent.
 */
async function adoptExistingSchema(pool: Pool, migrationsFolder: string): Promise<void> {
  const client = await pool.connect();
  try {
    // Does any of our canonical tables exist? Use Panel as the marker;
    // the Drizzle 0000_init.sql creates it among the first.
    const { rows: panelRows } = await client.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'Panel'
       ) AS exists`,
    );
    const panelExists = panelRows[0]?.exists === true;
    if (!panelExists) return;

    // Drizzle stores migrations under the `drizzle` schema by default
    // (older versions used public.__drizzle_migrations). Check both —
    // we pre-seed whichever the live drizzle-kit version expects.
    const { rows: trackerRows } = await client.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema IN ('drizzle', 'public')
           AND table_name = '__drizzle_migrations'
       ) AS exists`,
    );
    const trackerExists = trackerRows[0]?.exists === true;
    if (trackerExists) return;

    // Pre-seed: create the tracker (matching Drizzle's exact shape) and
    // insert the 0000_init hash. The migrator will then read this row,
    // see the hash already present, and skip the file.
    const initHash = hashSql(resolve(migrationsFolder, '0000_init.sql'));
    await client.query('CREATE SCHEMA IF NOT EXISTS drizzle');
    await client.query(`
      CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint
      )
    `);
    await client.query(
      `INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [initHash, Date.now()],
    );
  } finally {
    client.release();
  }
}

/**
 * Apply all unapplied Drizzle migrations against `databaseUrl`. Idempotent.
 * Throws on any DB error — caller (typically the bot's boot path) should
 * exit the process so the failure is visible.
 */
export async function runMigrations(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const folder = resolveMigrationsFolder();
    await adoptExistingSchema(pool, folder);
    const db = drizzle(pool);
    await migrate(db, { migrationsFolder: folder });
  } finally {
    await pool.end();
  }
}
