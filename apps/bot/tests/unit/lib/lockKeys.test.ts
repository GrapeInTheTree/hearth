import { describe, expect, it } from 'vitest';

import { ticketOpenLockKey } from '../../../src/lib/lockKeys.js';

describe('ticketOpenLockKey', () => {
  it('is deterministic — same input always produces same bigint', () => {
    const a = ticketOpenLockKey('g1', 'u1', 't1');
    const b = ticketOpenLockKey('g1', 'u1', 't1');
    expect(a).toBe(b);
  });

  it('differs for distinct guildIds', () => {
    expect(ticketOpenLockKey('g1', 'u1', 't1')).not.toBe(ticketOpenLockKey('g2', 'u1', 't1'));
  });

  it('differs for distinct openerIds', () => {
    expect(ticketOpenLockKey('g1', 'u1', 't1')).not.toBe(ticketOpenLockKey('g1', 'u2', 't1'));
  });

  it('differs for distinct typeIds', () => {
    expect(ticketOpenLockKey('g1', 'u1', 't1')).not.toBe(ticketOpenLockKey('g1', 'u1', 't2'));
  });

  it('returns a signed 64-bit value (within int8 range)', () => {
    const k = ticketOpenLockKey('g', 'u', 't');
    const min = -(2n ** 63n);
    const max = 2n ** 63n - 1n;
    expect(k).toBeGreaterThanOrEqual(min);
    expect(k).toBeLessThanOrEqual(max);
  });
});
