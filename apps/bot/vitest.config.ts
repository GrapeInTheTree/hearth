import { defineConfig } from 'vitest/config';

const RUN_INTEGRATION = process.env['RUN_INTEGRATION'] === '1';

// Single config, two execution modes:
// - default: unit only (FakeDiscordGateway, no DB connection), runs in <1s.
// - RUN_INTEGRATION=1: includes tests/integration/* (testcontainers pg 16),
//   default `test` script keeps fast feedback.
//
// Vitest's individual integration test files use `describe.runIf(...)` so
// they self-skip when run accidentally without the flag — defensive in
// case someone runs vitest directly.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: RUN_INTEGRATION
      ? ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts', 'src/**/*.test.ts']
      : ['tests/unit/**/*.test.ts', 'src/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts'],
    // testcontainers pull + migrate + 4 lifecycle scenarios takes ~30s on
    // a cold cache. Generous timeout when integration is enabled.
    testTimeout: RUN_INTEGRATION ? 60_000 : 5_000,
    hookTimeout: RUN_INTEGRATION ? 60_000 : 10_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/index.ts',
        'src/container.ts',
        'src/i18n/**',
        'src/commands/**',
        'src/listeners/**',
        'src/interaction-handlers/**',
        'src/preconditions/**',
        'src/services/ports/**',
        'src/services/index.ts',
        // server.ts is the http.createServer + dispatch glue. Its routing is
        // exercised end-to-end by the dashboard integration tests (PR-3+);
        // unit-testing it would require a TCP listen which slows the
        // <1s-target unit suite.
        'src/internal-api/server.ts',
        'src/internal-api/json.ts',
        'src/internal-api/types.ts',
        'src/lib/logger.ts',
        // Helpers are tightly coupled to interaction/listener flows; they're
        // exercised end-to-end by integration tests rather than unit-level.
        'src/lib/interactionHelpers.ts',
        'src/lib/replyEphemeral.ts',
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
