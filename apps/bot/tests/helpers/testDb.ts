import { spawnSync } from 'node:child_process';

import { type DbDrizzle, schema } from '@hearth/database';
import { runMigrations } from '@hearth/database/migrate';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

/**
 * Probe whether Docker is reachable so integration tests can self-skip on
 * developer machines without docker running. CI containers always have
 * docker, so this returns true there.
 */
export function isDockerAvailable(): boolean {
  const result = spawnSync('docker', ['info'], { encoding: 'utf-8', stdio: 'pipe' });
  return result.status === 0;
}

// Spins a real Postgres 16 container, applies the canonical Drizzle
// migrations via `runMigrations()`, and returns a Drizzle client wired
// through `pg.Pool`. This validates the same migrator the bot calls at
// boot — schema, indexes, partial unique index, FK enforcement, JSONB
// type parsers — end-to-end against production-equivalent Postgres.

export interface IntegrationDb {
  readonly db: DbDrizzle;
  readonly databaseUrl: string;
  readonly container: StartedPostgreSqlContainer;
  close(): Promise<void>;
}

const POSTGRES_IMAGE = 'postgres:16-alpine';

export async function startIntegrationDb(): Promise<IntegrationDb> {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE)
    .withDatabase('hearth_test')
    .withUsername('hearth')
    .withPassword('hearth')
    .start();

  const databaseUrl = container.getConnectionUri();

  // Run migrations the same way prod will (via `runMigrations` from
  // @hearth/database). On a fresh container, the migrator creates the
  // tracker table and applies 0000_init normally.
  await runMigrations(databaseUrl);

  // Construct a pool + Drizzle client for the test to use. `runMigrations`
  // drains its own pool on completion, so we open a fresh one here.
  const pool = new Pool({ connectionString: databaseUrl });
  const drizzleClient = drizzle(pool, { schema });
  await pool.query('SELECT 1');

  return {
    db: drizzleClient as unknown as DbDrizzle,
    databaseUrl,
    container,
    async close() {
      await pool.end();
      await container.stop();
    },
  };
}
