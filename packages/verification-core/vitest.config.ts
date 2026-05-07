import { defineConfig } from 'vitest/config';

// Unit tests — service + builder. Service tests run against PGlite (Postgres
// compiled to WASM) for real DB semantics; gateway calls are stubbed via the
// FakeDiscordGateway from @hearth/tickets-core/tests/helpers (verification
// reuses the tickets-core gateway port).
//
// Coverage thresholds match tickets-core (85/75/85/85). Excludes the barrel,
// the i18n bundle (data, no logic), and ports (interface declarations live
// in tickets-core anyway).
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
