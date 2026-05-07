import type { VerificationOption, VerificationPanel } from '@hearth/database';
import { encode } from '@hearth/tickets-core';
import type { Branding } from '@hearth/tickets-core';
import type { VerificationMessagePayload } from '@hearth/tickets-core';
import {
  type APIActionRowComponent,
  type APIButtonComponentWithCustomId,
  type APIComponentInMessageActionRow,
  type APIEmbed,
  ButtonStyle,
  ComponentType,
} from 'discord-api-types/v10';

// Verification message components: one button per VerificationOption,
// customId encodes (panelId, optionId) so the verification-submit handler
// can route directly without per-deployment lookup.
//
// One ActionRow with up to 5 buttons — matches the action-row capacity and
// the option's `position` 0..4 invariant. Buttons are sorted by position
// (ascending) so the visual order matches what operators configured.
//
// Output is plain JSON (discord-api-types shapes) so this module — and
// transitively all of @hearth/verification-core — never imports the
// discord.js runtime. The bot's djs gateway implementation passes the
// JSON straight through to channel.send({ components }).

const MAX_BUTTONS_PER_ROW = 5;

type CustomIdButtonStyle =
  | ButtonStyle.Primary
  | ButtonStyle.Secondary
  | ButtonStyle.Success
  | ButtonStyle.Danger;

const STYLE_MAP: Record<string, CustomIdButtonStyle> = {
  primary: ButtonStyle.Primary,
  secondary: ButtonStyle.Secondary,
  success: ButtonStyle.Success,
  danger: ButtonStyle.Danger,
};

export type VerificationComponentRow = APIActionRowComponent<APIComponentInMessageActionRow>;

/**
 * Build the verification message payload (embed + button row).
 * Empty `options` yields zero rows — the embed posts solo, which is the
 * "panel created without options yet" state. `correctOptionId` is not
 * encoded into buttons (any button can be clicked); the service layer
 * decides correctness server-side at click time.
 *
 * Throws if more than MAX_BUTTONS_PER_ROW options are passed — the schema
 * already enforces 0..4 position on each option, but two options at the
 * same position would not be caught there.
 */
export function buildVerificationPayload(
  panel: Pick<VerificationPanel, 'embedTitle' | 'embedDescription'>,
  options: readonly VerificationOption[],
  branding: Pick<Branding, 'color'>,
): VerificationMessagePayload {
  const embed: APIEmbed = {
    title: panel.embedTitle,
    description: panel.embedDescription,
    color: branding.color,
  };

  if (options.length === 0) {
    return { content: undefined, embeds: [embed], components: [] };
  }

  if (options.length > MAX_BUTTONS_PER_ROW) {
    throw new Error(
      `Verification panel has ${String(options.length)} options but Discord allows at most ${String(MAX_BUTTONS_PER_ROW)} buttons per row`,
    );
  }

  const ordered = [...options].sort((a, b) => a.position - b.position);
  const row: VerificationComponentRow = {
    type: ComponentType.ActionRow,
    components: ordered.map(buildButton),
  };
  return { content: undefined, embeds: [embed], components: [row] };
}

function buildButton(option: VerificationOption): APIButtonComponentWithCustomId {
  const button: APIButtonComponentWithCustomId = {
    type: ComponentType.Button,
    style: STYLE_MAP[option.buttonStyle] ?? ButtonStyle.Primary,
    custom_id: encode('verification:submit', {
      panelId: option.panelId,
      optionId: option.id,
    }),
    label: option.label,
  };
  if (option.emoji !== '') {
    return { ...button, emoji: parseEmoji(option.emoji) };
  }
  return button;
}

interface ParsedEmoji {
  readonly id?: string;
  readonly name: string;
  readonly animated?: boolean;
}

/**
 * Discord button emoji can be a Unicode codepoint (`name` only) or a custom
 * server emoji (`id` + `name` + `animated?`). We accept both forms so the
 * shape stored in the DB remains a single text column.
 *
 * Custom emoji format: `<:name:id>` (static) or `<a:name:id>` (animated).
 */
function parseEmoji(raw: string): ParsedEmoji {
  const customMatch = /^<(a)?:([A-Za-z0-9_]{2,32}):(\d{17,20})>$/.exec(raw);
  if (customMatch !== null) {
    const [, animatedFlag, name, id] = customMatch;
    if (name === undefined || id === undefined) return { name: raw };
    return animatedFlag === undefined ? { name, id } : { name, id, animated: true };
  }
  return { name: raw };
}
