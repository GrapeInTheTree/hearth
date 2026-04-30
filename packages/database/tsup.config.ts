import { defineConfig } from 'tsup';

export default defineConfig({
  // Two entries:
  //  - src/index.ts is the package's public surface (Drizzle client +
  //    schema + types + error helpers).
  //  - src/migrate.ts is the runtime migrator entry, called from the
  //    bot's boot path to apply unapplied Drizzle migrations against
  //    DATABASE_URL. Bundling it separately keeps the migrator's
  //    dependency on `node:fs`/`node:path` from leaking into the main
  //    surface (which Next.js loads at build time).
  entry: ['src/index.ts', 'src/migrate.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  dts: false,
  sourcemap: true,
  clean: true,
  treeshake: true,
  splitting: false,
  // `pg`/`pg-native` are runtime-only and pulled from node_modules at
  // production time. `@prisma/*` externalization lingers from the
  // pre-PR-6 transition; PR-6 removes both the patterns and the
  // package altogether.
  external: [/^@prisma\//, 'pg', 'pg-native'],
});
