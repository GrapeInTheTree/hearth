import { defineConfig } from 'vitest/config';

// Unit tests — services + lib. Service tests run against PGlite (Postgres
// compiled to WASM) for real DB semantics; gateway calls are stubbed via
// FakeDiscordGateway. Apps/bot/tests/integration uses testcontainers
// Postgres 16 for production-equivalent verification of bot wiring.
//
// Coverage thresholds match apps/bot (85/75/85/85). Excludes generated entry
// points, the i18n bundle (data, no logic), and ports (interface declarations).
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'src/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts'],
    // PGlite cold-starts ~30ms per test setup; the partial-unique race
    // test runs concurrent tx work. 15s is generous safety ceiling.
    testTimeout: 15_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/index.ts',
        'src/branding.ts',
        'src/i18n/**',
        'src/ports/**',
      ],
      thresholds: {
        lines: 85,
        branches: 75,
        functions: 85,
        statements: 85,
      },
    },
  },
});
