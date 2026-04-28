import { defineConfig } from 'vitest/config';

// Unit tests only — services + lib + helpers using FakeDb + FakeGateway.
// Integration tests (testcontainers pg 16) live in apps/bot/tests/integration
// and import services from this package via @hearth/tickets-core.
//
// Coverage thresholds match apps/bot (85/75/85/85). Excludes generated entry
// points, the i18n bundle (data, no logic), and ports (interface declarations).
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'src/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 5_000,
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
