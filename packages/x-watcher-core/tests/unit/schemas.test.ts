import { describe, expect, it } from 'vitest';

import { XWatcherEditSchema, XWatcherInputSchema } from '../../src/schemas.js';

// The schema is the input-layer guard shared by the dashboard form and
// the bot slash command. It normalises however operators type a handle
// (with @, as a URL, with stray spaces) down to the bare handle, then
// pins X's 1–15 char letter/digit/underscore rule.

const guildId = '111111111111111111';
const channelId = '222222222222222222';

describe('XWatcherInputSchema.sourceHandle', () => {
  it('strips a leading @', () => {
    const r = XWatcherInputSchema.safeParse({ guildId, channelId, sourceHandle: '@KayenFinance' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.sourceHandle).toBe('KayenFinance');
  });

  it('extracts the handle from a profile URL', () => {
    for (const url of [
      'https://x.com/KayenFinance',
      'https://twitter.com/KayenFinance',
      'https://www.x.com/KayenFinance/',
      'x.com/KayenFinance',
    ]) {
      const r = XWatcherInputSchema.safeParse({ guildId, channelId, sourceHandle: url });
      expect(r.success, url).toBe(true);
      if (r.success) expect(r.data.sourceHandle).toBe('KayenFinance');
    }
  });

  it('trims surrounding whitespace', () => {
    const r = XWatcherInputSchema.safeParse({
      guildId,
      channelId,
      sourceHandle: '  KayenFinance ',
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.sourceHandle).toBe('KayenFinance');
  });

  it('accepts underscores and digits', () => {
    const r = XWatcherInputSchema.safeParse({ guildId, channelId, sourceHandle: 'kayen_fi_2026' });
    expect(r.success).toBe(true);
  });

  it.each(['', 'has spaces', 'way_too_long_handle_x', 'bad-dash', 'emoji😀'])(
    'rejects an invalid handle: %s',
    (sourceHandle) => {
      const r = XWatcherInputSchema.safeParse({ guildId, channelId, sourceHandle });
      expect(r.success).toBe(false);
    },
  );
});

describe('XWatcherInputSchema toggles', () => {
  it('leaves toggles undefined when absent (service applies column defaults)', () => {
    const r = XWatcherInputSchema.safeParse({ guildId, channelId, sourceHandle: 'KayenFinance' });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.includeQuotes).toBeUndefined();
      expect(r.data.includeReplies).toBeUndefined();
    }
  });

  it("coerces a form's 'true' / 'false' strings to booleans", () => {
    const r = XWatcherInputSchema.safeParse({
      guildId,
      channelId,
      sourceHandle: 'KayenFinance',
      includeReplies: 'true',
      includeQuotes: 'false',
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.includeReplies).toBe(true);
      expect(r.data.includeQuotes).toBe(false);
    }
  });
});

describe('XWatcherEditSchema', () => {
  it('has no sourceHandle field — the account is immutable', () => {
    // A handle passed to the edit schema is simply ignored (not in the shape).
    const r = XWatcherEditSchema.safeParse({ channelId, sourceHandle: 'Other' });
    expect(r.success).toBe(true);
    if (r.success) expect('sourceHandle' in r.data).toBe(false);
  });
});
