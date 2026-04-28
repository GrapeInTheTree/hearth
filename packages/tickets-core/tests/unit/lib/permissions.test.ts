import { PermissionError } from '@hearth/shared';
import { describe, expect, it } from 'vitest';

import {
  assertManageGuild,
  assertSupportStaff,
  hasManageGuild,
  isSupportStaff,
} from '../../../src/lib/permissions.js';

// MANAGE_GUILD = bit 5 (= 32 = 0x20). Discord API constant — see
// https://discord.com/developers/docs/topics/permissions. Inlined as bigint
// so this test stays free of the discord.js runtime.
const MANAGE_GUILD_BIT = 1n << 5n;
const MANAGE_CHANNELS_BIT = 1n << 4n;

describe('hasManageGuild', () => {
  it('returns true when ManageGuild bit is set', () => {
    expect(hasManageGuild(MANAGE_GUILD_BIT)).toBe(true);
  });

  it('returns true when bitfield includes ManageGuild + others', () => {
    const bits = MANAGE_GUILD_BIT | MANAGE_CHANNELS_BIT;
    expect(hasManageGuild(bits)).toBe(true);
  });

  it('returns false when bit is unset', () => {
    expect(hasManageGuild(MANAGE_CHANNELS_BIT)).toBe(false);
  });

  it('returns false for empty bitfield', () => {
    expect(hasManageGuild(0n)).toBe(false);
  });
});

describe('isSupportStaff', () => {
  it('returns true when actor has at least one support role', () => {
    expect(isSupportStaff(['r1', 'r2'], ['r2', 'r3'])).toBe(true);
  });

  it('returns false when no roles intersect', () => {
    expect(isSupportStaff(['r1'], ['r2', 'r3'])).toBe(false);
  });

  it('returns false when configured supportRoleIds is empty', () => {
    expect(isSupportStaff(['r1', 'r2'], [])).toBe(false);
  });

  it('returns false when actor has no roles', () => {
    expect(isSupportStaff([], ['r1'])).toBe(false);
  });
});

describe('assert helpers', () => {
  it('assertManageGuild throws PermissionError when bit unset', () => {
    expect(() => assertManageGuild(0n)).toThrow(PermissionError);
  });

  it('assertManageGuild does not throw when bit set', () => {
    expect(() => assertManageGuild(MANAGE_GUILD_BIT)).not.toThrow();
  });

  it('assertSupportStaff throws PermissionError on miss', () => {
    expect(() => assertSupportStaff(['r1'], ['r2'])).toThrow(PermissionError);
  });
});
