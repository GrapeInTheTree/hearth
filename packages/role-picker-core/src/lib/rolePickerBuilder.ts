import type { RolePickerOption, RolePickerPanel } from '@hearth/database';
import type { Branding, RolePickerMessagePayload } from '@hearth/tickets-core';
import {
  type APIActionRowComponent,
  type APIComponentInMessageActionRow,
  type APIEmbed,
  type APIMessageComponentEmoji,
  type APIStringSelectComponent,
  ComponentType,
} from 'discord-api-types/v10';

import { rolePicker as i18n } from '../i18n/index.js';

// Role-picker message payload — embed + a single ActionRow containing
// one StringSelectMenu. The dropdown's `value` for each option is the
// option's cuid2 id; the bot's interaction handler looks the id up
// directly when the user submits.
//
// Output is plain JSON (discord-api-types shapes) so this module — and
// transitively all of @hearth/role-picker-core — never imports the
// discord.js runtime. The bot's djs gateway passes the JSON straight
// through to channel.send({ embeds, components }).

// Type alias rather than an empty extending interface — they're
// structurally identical and lint rejects the empty-interface form.
export type RolePickerPayload = RolePickerMessagePayload;

/** Build the message payload for a role-picker panel. Always includes
 *  the StringSelectMenu component row — even when the option list is
 *  empty, callers should special-case (Discord rejects empty menus
 *  with 50035; service-side validation catches this before render). */
export function buildRolePickerPayload(
  panel: Pick<
    RolePickerPanel,
    'embedTitle' | 'embedDescription' | 'placeholder' | 'minValues' | 'maxValues' | 'customId'
  >,
  options: readonly RolePickerOption[],
  branding: Pick<Branding, 'color'>,
): RolePickerPayload {
  const ordered = [...options].sort((a, b) => a.position - b.position);
  const lines = ordered.map(renderOptionLine);

  const description =
    lines.length > 0 ? [panel.embedDescription, '', ...lines].join('\n') : panel.embedDescription;

  const embed: APIEmbed = {
    title: panel.embedTitle,
    description,
    color: branding.color,
  };

  const selectMenu: APIStringSelectComponent = {
    type: ComponentType.StringSelect,
    custom_id: panel.customId,
    placeholder: panel.placeholder,
    min_values: panel.minValues,
    max_values: Math.max(panel.minValues, Math.min(panel.maxValues, ordered.length || 1)),
    options: ordered.map((o) => {
      const emoji = parseEmoji(o.emoji);
      const base: APIStringSelectComponent['options'][number] = {
        label: o.label,
        value: o.id,
        ...(o.description !== null ? { description: o.description } : {}),
      };
      return emoji !== undefined ? { ...base, emoji } : base;
    }),
  };

  const row: APIActionRowComponent<APIComponentInMessageActionRow> = {
    type: ComponentType.ActionRow,
    components: [selectMenu],
  };

  return {
    content: undefined,
    embeds: [embed],
    components: ordered.length > 0 ? [row] : [],
  };
}

function renderOptionLine(option: RolePickerOption): string {
  return i18n.optionLine
    .replace('{emoji}', option.emoji ?? '•')
    .replace('{label}', option.label)
    .replace('{roleId}', option.roleId);
}

// `<a?:name:id>` → APIMessageComponentEmoji `{id, name, animated?}`.
// Unicode emoji → `{name}` (id omitted). Empty / null → undefined so
// the caller can omit the field entirely. With exactOptionalPropertyTypes,
// we must omit keys we don't want rather than passing `undefined`.
function parseEmoji(raw: string | null): APIMessageComponentEmoji | undefined {
  if (raw === null || raw.length === 0) return undefined;
  const match = /^<(a?):([A-Za-z0-9_]{2,32}):(\d{17,20})>$/.exec(raw);
  if (match !== null) {
    const [, animated, name, id] = match;
    if (id === undefined || name === undefined) return { name: raw };
    return {
      id,
      name,
      ...(animated === 'a' ? { animated: true } : {}),
    };
  }
  return { name: raw };
}
