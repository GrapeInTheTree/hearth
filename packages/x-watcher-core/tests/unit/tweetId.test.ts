import { describe, expect, it } from 'vitest';

import { compareTweetId, isNewerThan } from '../../src/lib/tweetId.js';

// Snowflake ids exceed Number.MAX_SAFE_INTEGER and vary in length, so
// ordering must be numeric-on-BigInt, never lexicographic.

describe('compareTweetId', () => {
  it('orders numerically, not lexicographically', () => {
    // Lexicographically "9" > "10"; numerically 9 < 10.
    expect(compareTweetId('9', '10')).toBeLessThan(0);
    expect(compareTweetId('10', '9')).toBeGreaterThan(0);
  });

  it('handles full 64-bit snowflakes beyond MAX_SAFE_INTEGER', () => {
    const older = '1797000000000000000';
    const newer = '1797000000000000001';
    expect(compareTweetId(older, newer)).toBeLessThan(0);
    expect(compareTweetId(newer, older)).toBeGreaterThan(0);
    expect(compareTweetId(newer, newer)).toBe(0);
  });

  it('falls back to string comparison for non-numeric ids', () => {
    expect(compareTweetId('abc', 'abd')).toBeLessThan(0);
    expect(compareTweetId('abc', 'abc')).toBe(0);
  });
});

describe('isNewerThan', () => {
  it('is false against a null cursor (first poll seeds, never posts)', () => {
    expect(isNewerThan('1797000000000000000', null)).toBe(false);
  });

  it('is true only for strictly newer ids', () => {
    const cursor = '1797000000000000000';
    expect(isNewerThan('1797000000000000001', cursor)).toBe(true);
    expect(isNewerThan(cursor, cursor)).toBe(false);
    expect(isNewerThan('1796000000000000000', cursor)).toBe(false);
  });
});
