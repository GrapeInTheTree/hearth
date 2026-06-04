import { defineConfig } from 'vitest/config';

// Unit tests — watcher service + poll algorithm + classifier + schemas.
// Same setup as role-picker-core: PGlite for real Postgres semantics
// in-memory, the feed source + Discord gateway stubbed via the fakes in
// tests/helpers. No discord.js, no network, no real X API.

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'src/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 15_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts', 'src/i18n/**'],
      thresholds: {
        lines: 85,
        branches: 75,
        functions: 85,
        statements: 85,
      },
    },
  },
});
