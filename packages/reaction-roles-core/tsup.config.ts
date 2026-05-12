import { defineConfig } from 'tsup';

export default defineConfig({
  // schemas.ts is a separate entry so dashboard client components can
  // import zod schemas without webpack pulling in the whole barrel
  // (which transitively reaches @hearth/database → pg → node:dns/net/tls).
  entry: ['src/index.ts', 'src/schemas.ts'],
  format: ['esm'],
  target: 'node22',
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  splitting: false,
});
