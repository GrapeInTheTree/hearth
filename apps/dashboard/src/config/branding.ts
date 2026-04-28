import type { Branding } from '@hearth/tickets-core';

import { env } from '../lib/env';

/**
 * Frozen branding object derived from env. Mirrors apps/bot/src/config/branding.ts
 * — same env keys, same shape — so a single set of operator env vars drives both
 * the bot's Discord embeds and the dashboard's chrome.
 *
 * Color is parsed from the BOT_BRAND_COLOR hex (validated by env.ts) into a
 * 24-bit integer matching discord.js's Embed.color format.
 */
function hexToInt(hex: string): number {
  return parseInt(hex.slice(1), 16);
}

export const branding: Branding = Object.freeze({
  name: env.BOT_NAME,
  color: hexToInt(env.BOT_BRAND_COLOR),
  iconUrl: env.BOT_ICON_URL,
  footerText: env.BOT_FOOTER_TEXT,
  supportUrl: env.BOT_SUPPORT_URL,
  locale: env.BOT_LOCALE,
});

/** CSS color helper — converts the 24-bit color int to `#rrggbb` for inline styles. */
export function brandColorCss(): string {
  return `#${branding.color.toString(16).padStart(6, '0')}`;
}
