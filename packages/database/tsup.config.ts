import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node22',
  // DTS via rollup-dts can't follow Prisma 6's `.prisma/client` indirection.
  // Consumers get types from the source TS file (see "types" in package.json).
  dts: false,
  sourcemap: true,
  clean: true,
  treeshake: true,
  splitting: false,
  external: ['@prisma/client'],
});
