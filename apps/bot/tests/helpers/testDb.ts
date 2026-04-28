import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import { type DbClient, PrismaClient } from '@hearth/database';
import { PrismaPg } from '@prisma/adapter-pg';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';

/**
 * Probe whether Docker is reachable so integration tests can self-skip on
 * developer machines without docker running. CI containers always have
 * docker, so this returns true there.
 */
export function isDockerAvailable(): boolean {
  const result = spawnSync('docker', ['info'], { encoding: 'utf-8', stdio: 'pipe' });
  return result.status === 0;
}

// Spins a real Postgres 16 container, runs `prisma migrate deploy` against
// it (using the same migration SQL the production deploy will run), and
// returns a typed Prisma client wired with the same PrismaPg adapter that
// production uses. This validates schema, migrations, indexes, and the
// driver-adapter pattern end-to-end — things the unit-level fakeDb can't.

export interface IntegrationDb {
  readonly db: DbClient;
  readonly databaseUrl: string;
  readonly container: StartedPostgreSqlContainer;
  close(): Promise<void>;
}

const POSTGRES_IMAGE = 'postgres:16-alpine';

// Resolve the database package directory once. The migration SQL + prisma
// schema both live there and are addressed by `prisma migrate deploy`.
const databasePackageDir = resolve(import.meta.dirname, '../../../../packages/database');

export async function startIntegrationDb(): Promise<IntegrationDb> {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE)
    .withDatabase('discord_bot_test')
    .withUsername('bot')
    .withPassword('bot')
    .start();

  const databaseUrl = container.getConnectionUri();

  // `prisma migrate deploy` is the production-equivalent migration runner.
  // We invoke it via pnpm so its prisma-config.ts loader runs, picking up
  // DATABASE_URL from env.
  const result = spawnSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd: databasePackageDir,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: 'utf-8',
  });
  if (result.status !== 0) {
    await container.stop();
    throw new Error(
      `prisma migrate deploy failed (status=${String(result.status)}):\n${result.stdout}\n${result.stderr}`,
    );
  }

  const adapter = new PrismaPg({ connectionString: databaseUrl });
  const client = new PrismaClient({ adapter });
  // Smoke-test the connection so test failures surface here rather than
  // mid-test.
  await client.$queryRaw`SELECT 1`;

  return {
    db: client as unknown as DbClient,
    databaseUrl,
    container,
    async close() {
      await client.$disconnect();
      await container.stop();
    },
  };
}
