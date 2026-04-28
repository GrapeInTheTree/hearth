import type { Branding } from '../../src/branding.js';

// Test-only Branding object. Production reads BOT_NAME / BOT_BRAND_COLOR /
// etc. from env in apps/bot/src/config/branding.ts; tests assert against
// constructor wiring, not env semantics, so a frozen literal is fine.
export const branding: Branding = Object.freeze({
  name: 'TestBot',
  color: 0x5865f2,
  iconUrl: undefined,
  footerText: undefined,
  supportUrl: undefined,
  locale: 'en',
});
