import { defineConfig } from 'drizzle-kit';

// Drizzle migration generator config. `drizzle-kit generate` reads the
// schema, diffs against the previous snapshot in `drizzle/meta/`, and
// emits a numbered `.sql` file under `drizzle/`. The runtime migrator
// (PR-4) replays unapplied files against `__drizzle_migrations` —
// forward-only, no `migrate dev` interactive flow.
//
// `dbCredentials.url` is read from env when running commands that need a
// live DB (introspect / push / studio). `generate` does not connect, so
// a placeholder is fine for build-time invocation.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './drizzle',
  // No `casing` — DB column names are explicitly set in each schema file
  // (e.g. `text('guildId')`). Drizzle's casing option only converts JS
  // symbol names to DB names, which we never rely on.
  dbCredentials: {
    url: process.env['DATABASE_URL'] ?? 'postgresql://placeholder@localhost:5432/placeholder',
  },
  verbose: true,
  strict: true,
});
