import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts'],
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
        'src/interactions/**',
        'src/preconditions/**',
        // Discord adapter wrappers — covered by integration tests (PR-5),
        // not unit. Their job is to translate discord.js exceptions; the
        // service layer's mockable seam is the DiscordGateway interface.
        'src/services/ports/**',
        'src/services/index.ts',
        // HTTP healthcheck — startup/teardown smoke covered by docker
        // healthcheck and graceful-shutdown manual verification.
        'src/healthcheck/**',
        // Trivial enum mapping; tested implicitly by env.test.ts.
        'src/lib/logger.ts',
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
