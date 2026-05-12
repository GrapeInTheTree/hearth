import type { RolePickerOption, RolePickerPanel } from '@hearth/database';
import { ComponentType } from 'discord-api-types/v10';
import { describe, expect, it } from 'vitest';

import { buildRolePickerPayload } from '../../src/lib/rolePickerBuilder.js';
import { branding } from '../helpers/testBranding.js';

// Pure-function tests for the payload builder. No DB, no gateway —
// just data in, JSON out. Validates the StringSelectMenu shape +
// emoji parsing + option ordering.

function panel(overrides: Partial<RolePickerPanel> = {}): RolePickerPanel {
  return {
    id: 'p1',
    guildId: 'g1',
    channelId: 'c1',
    messageId: 'pending',
    embedTitle: 'Pick',
    embedDescription: 'Choose one.',
    placeholder: 'Pick a role…',
    selectionMode: 'single',
    minValues: 1,
    maxValues: 1,
    customId: 'role-picker:submit|{"panelId":"p1"}',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function option(overrides: Partial<RolePickerOption>): RolePickerOption {
  return {
    id: 'o-id',
    panelId: 'p1',
    label: 'Korean',
    description: null,
    emoji: '🇰🇷',
    roleId: 'r1',
    position: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('buildRolePickerPayload', () => {
  it('emits exactly one ActionRow with one StringSelectMenu', () => {
    const out = buildRolePickerPayload(
      panel(),
      [option({ id: 'a', label: 'A', position: 0 })],
      branding,
    );
    expect(out.components).toHaveLength(1);
    // Type narrowed via shape — runtime cast for the index lookup
    const row = out.components[0] as {
      type: number;
      components: {
        type: number;
        custom_id: string;
        options: { label: string; value: string }[];
      }[];
    };
    expect(row.type).toBe(ComponentType.ActionRow);
    expect(row.components).toHaveLength(1);
    const menu = row.components[0]!;
    expect(menu.type).toBe(ComponentType.StringSelect);
    expect(menu.custom_id).toBe('role-picker:submit|{"panelId":"p1"}');
    expect(menu.options.map((o) => o.value)).toEqual(['a']);
  });

  it('orders options by position ascending', () => {
    const out = buildRolePickerPayload(
      panel(),
      [
        option({ id: 'c', label: 'C', position: 2 }),
        option({ id: 'a', label: 'A', position: 0 }),
        option({ id: 'b', label: 'B', position: 1 }),
      ],
      branding,
    );
    const row = out.components[0] as { components: { options: { value: string }[] }[] };
    const menu = row.components[0]!;
    expect(menu.options.map((o) => o.value)).toEqual(['a', 'b', 'c']);
  });

  it('parses custom emoji <:name:id> into the structured shape', () => {
    const out = buildRolePickerPayload(
      panel(),
      [option({ id: 'a', emoji: '<:pepe:1234567890123456789>' })],
      branding,
    );
    const row = out.components[0] as {
      components: { options: { emoji?: { id?: string; name: string } }[] }[];
    };
    const emoji = row.components[0]!.options[0]!.emoji;
    expect(emoji).toEqual({ id: '1234567890123456789', name: 'pepe' });
  });

  it('omits components entirely when the panel has no options', () => {
    const out = buildRolePickerPayload(panel(), [], branding);
    expect(out.components).toEqual([]);
    expect(out.embeds).toHaveLength(1);
  });

  it('clamps maxValues to the available option count', () => {
    const out = buildRolePickerPayload(
      panel({ minValues: 1, maxValues: 25 }),
      [
        option({ id: 'a', position: 0 }),
        option({ id: 'b', label: 'B', roleId: 'r2', position: 1 }),
      ],
      branding,
    );
    const row = out.components[0] as {
      components: { max_values: number; min_values: number }[];
    };
    expect(row.components[0]!.max_values).toBe(2);
  });
});
