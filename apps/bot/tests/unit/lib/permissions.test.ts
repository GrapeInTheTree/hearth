import { PermissionError } from '@discord-bot/shared';
import { PermissionFlagsBits } from 'discord.js';
import { describe, expect, it } from 'vitest';

import {
  assertManageGuild,
  assertSupportStaff,
  hasManageGuild,
  isSupportStaff,
} from '../../../src/lib/permissions.js';

describe('hasManageGuild', () => {
  it('returns true when ManageGuild bit is set', () => {
    expect(hasManageGuild(PermissionFlagsBits.ManageGuild)).toBe(true);
  });

  it('returns true when bitfield includes ManageGuild + others', () => {
    const bits = PermissionFlagsBits.ManageGuild | PermissionFlagsBits.ManageChannels;
    expect(hasManageGuild(bits)).toBe(true);
  });

  it('returns false when bit is unset', () => {
    expect(hasManageGuild(PermissionFlagsBits.ManageChannels)).toBe(false);
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
    expect(() => assertManageGuild(PermissionFlagsBits.ManageGuild)).not.toThrow();
  });

  it('assertSupportStaff throws PermissionError on miss', () => {
    expect(() => assertSupportStaff(['r1'], ['r2'])).toThrow(PermissionError);
  });
});
