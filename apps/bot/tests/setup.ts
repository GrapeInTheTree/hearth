// Vitest setup — set env stubs at TOP LEVEL (not in beforeAll) so they're in
// place before any test file's imports trigger env.ts module-load side effects.
//
// Tests that exercise loadEnv() directly should pass a custom env object
// rather than rely on these defaults.

process.env['DISCORD_TOKEN'] ??= 'x'.repeat(60);
process.env['DISCORD_APP_ID'] ??= '123456789012345678';
process.env['BOT_NAME'] ??= 'TestBot';
process.env['DATABASE_URL'] ??= 'postgresql://test:test@localhost:5432/test';
process.env['NODE_ENV'] ??= 'test';

// PR-6 onward: panel/type config is operator-driven (slash commands), not env.
// Only TICKET_ARCHIVE_CATEGORY_ID + BOT_LOG_CHANNEL_ID remain as env knobs,
// both optional. Tests that need the archive category set it via
// guildConfigService.setArchiveCategory; we intentionally leave the env unset
// here so services that read env directly are exercised on the optional path.
