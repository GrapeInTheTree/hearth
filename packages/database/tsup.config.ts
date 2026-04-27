import { defineConfig } from 'tsup';

export default defineConfig({
  // Single bundle entry through the package surface. tsup follows imports
  // into src/generated/client/* (Prisma 7 prisma-client generator output)
  // and inlines them — that keeps the published package self-contained
  // while still importing @prisma/client/runtime/client externally for
  // the heavy engine code.
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  dts: false,
  sourcemap: true,
  clean: true,
  treeshake: true,
  splitting: false,
  external: [/^@prisma\//, 'pg', 'pg-native'],
});
