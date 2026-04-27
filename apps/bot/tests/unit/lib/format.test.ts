import { describe, expect, it } from 'vitest';

import { formatChannelName, normalizeUsername } from '../../../src/lib/format.js';

describe('normalizeUsername', () => {
  it('lowercases ASCII names', () => {
    expect(normalizeUsername('CarlosMarronB')).toBe('carlosmarronb');
  });

  it('keeps digits and hyphens', () => {
    expect(normalizeUsername('user-123')).toBe('user-123');
  });

  it('replaces non-ASCII runs with single underscore', () => {
    expect(normalizeUsername('Hépì Lu')).toBe('h_p_lu');
  });

  it('collapses repeated separators', () => {
    expect(normalizeUsername('a   b')).toBe('a_b');
  });

  it('trims leading/trailing separators', () => {
    expect(normalizeUsername('-hello-')).toBe('hello');
  });

  it('returns empty string when nothing usable remains', () => {
    expect(normalizeUsername('한글')).toBe('');
    expect(normalizeUsername('🎉🎊')).toBe('');
  });
});

describe('formatChannelName', () => {
  it('produces {number}-{username} for normal usernames', () => {
    expect(formatChannelName(1429, 'GuntherDether', '999')).toBe('1429-guntherdether');
  });

  it('falls back to user-{id} when normalization yields empty', () => {
    expect(formatChannelName(7, '한글', '999')).toBe('7-user-999');
  });

  it('caps at 80 chars', () => {
    const long = 'a'.repeat(120);
    expect(formatChannelName(1, long, '999').length).toBeLessThanOrEqual(80);
  });
});
