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

// Phase 1 ticket env stubs — populated in PR-2's env.ts schema.
// Snowflake placeholders pass the 17–20 digit regex without matching real IDs.
process.env['TICKET_SUPPORT_PANEL_CHANNEL_ID'] ??= '111111111111111111';
process.env['TICKET_OFFER_PANEL_CHANNEL_ID'] ??= '222222222222222222';
process.env['TICKET_ACTIVE_CATEGORY_ID'] ??= '333333333333333333';
process.env['TICKET_ARCHIVE_CATEGORY_ID'] ??= '444444444444444444';
process.env['TICKET_SUPPORT_ROLE_IDS'] ??= '';
process.env['TICKET_SUPPORT_MENTION_ROLE_IDS'] ??= '';
process.env['TICKET_OFFER_MENTION_ROLE_IDS'] ??= '';
// BOT_LOG_CHANNEL_ID intentionally unset — services must handle the optional case.
