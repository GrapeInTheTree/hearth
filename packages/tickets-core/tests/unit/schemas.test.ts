import { describe, expect, it } from 'vitest';

import {
  GuildConfigInputSchema,
  PanelInputSchema,
  TicketTypeInputSchema,
} from '../../src/schemas.js';

describe('PanelInputSchema', () => {
  it('accepts a minimal valid input', () => {
    const result = PanelInputSchema.safeParse({
      guildId: '123456789012345678',
      channelId: '234567890123456789',
    });
    expect(result.success).toBe(true);
  });

  it('accepts optional title and description', () => {
    const result = PanelInputSchema.safeParse({
      guildId: '123456789012345678',
      channelId: '234567890123456789',
      embedTitle: 'Contact Team',
      embedDescription: 'Pick a button below.',
    });
    expect(result.success).toBe(true);
  });

  it('rejects malformed snowflake', () => {
    const result = PanelInputSchema.safeParse({
      guildId: 'not-a-snowflake',
      channelId: '234567890123456789',
    });
    expect(result.success).toBe(false);
  });

  it('rejects oversize description', () => {
    const result = PanelInputSchema.safeParse({
      guildId: '123456789012345678',
      channelId: '234567890123456789',
      embedDescription: 'x'.repeat(5000),
    });
    expect(result.success).toBe(false);
  });
});

describe('TicketTypeInputSchema', () => {
  const base = {
    panelId: 'pid',
    name: 'question',
    label: 'Question',
    emoji: '❓',
    activeCategoryId: '111111111111111111',
    supportRoleIds: ['222222222222222222'],
    pingRoleIds: [],
    perUserLimit: 1,
  };

  it('accepts valid input', () => {
    expect(TicketTypeInputSchema.safeParse(base).success).toBe(true);
  });

  it('rejects uppercase name', () => {
    expect(TicketTypeInputSchema.safeParse({ ...base, name: 'Question' }).success).toBe(false);
  });

  it('rejects label > 80 chars', () => {
    expect(TicketTypeInputSchema.safeParse({ ...base, label: 'x'.repeat(81) }).success).toBe(false);
  });

  it('accepts null perUserLimit', () => {
    expect(TicketTypeInputSchema.safeParse({ ...base, perUserLimit: null }).success).toBe(true);
  });
});

describe('GuildConfigInputSchema', () => {
  it('accepts a guildId-only input', () => {
    expect(GuildConfigInputSchema.safeParse({ guildId: '123456789012345678' }).success).toBe(true);
  });

  it('accepts null clearing values', () => {
    expect(
      GuildConfigInputSchema.safeParse({
        guildId: '123456789012345678',
        archiveCategoryId: null,
        alertChannelId: null,
      }).success,
    ).toBe(true);
  });
});
