import type { PanelTicketType } from '@hearth/database';
import {
  type APIActionRowComponent,
  type APIButtonComponentWithCustomId,
  type APIComponentInMessageActionRow,
  ButtonStyle,
  ComponentType,
} from 'discord-api-types/v10';

import { encode } from './customId.js';

// Panel message components: one button per active PanelTicketType, the
// customId encodes (panelId, typeId) so the panel-open handler can route
// directly without a per-deployment lookup table.
//
// Discord allows up to 5 buttons per ActionRow and up to 5 rows per
// message. We chunk types across rows respecting the 5-per-row limit;
// an operator with 25+ types should split them across multiple panels.
//
// Output is plain JSON (discord-api-types shapes) so this module — and
// transitively all of @hearth/tickets-core — never imports the
// discord.js runtime. The bot's djs gateway implementation passes the
// JSON straight through to channel.send({ components }).

const MAX_BUTTONS_PER_ROW = 5;
const MAX_ROWS_PER_MESSAGE = 5;

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

export type PanelComponentRow = APIActionRowComponent<APIComponentInMessageActionRow>;

/**
 * Render the panel's button rows. Empty `types` yields zero rows — the
 * panel embed displays without any buttons (operator's signal to add
 * types via /panel ticket-type add).
 *
 * Throws if the operator configured more types than fit (5 rows × 5).
 * That's a hard Discord limit, not something we want to silently truncate.
 */
export function buildPanelComponents(types: readonly PanelTicketType[]): PanelComponentRow[] {
  if (types.length === 0) return [];
  const ordered = [...types].sort(byButtonOrder);
  const maxButtons = MAX_BUTTONS_PER_ROW * MAX_ROWS_PER_MESSAGE;
  if (ordered.length > maxButtons) {
    throw new Error(
      `Panel has ${String(ordered.length)} ticket types but Discord allows at most ${String(maxButtons)} buttons per message`,
    );
  }

  const rows: PanelComponentRow[] = [];
  for (let i = 0; i < ordered.length; i += MAX_BUTTONS_PER_ROW) {
    const slice = ordered.slice(i, i + MAX_BUTTONS_PER_ROW);
    rows.push({
      type: ComponentType.ActionRow,
      components: slice.map((t) => buildButton(t)),
    });
  }
  return rows;
}

function buildButton(type: PanelTicketType): APIButtonComponentWithCustomId {
  const button: APIButtonComponentWithCustomId = {
    type: ComponentType.Button,
    style: STYLE_MAP[type.buttonStyle] ?? ButtonStyle.Success,
    custom_id: encode('panel:open', { panelId: type.panelId, typeId: type.id }),
    label: type.buttonLabel ?? type.name,
  };
  if (type.emoji !== '') {
    return { ...button, emoji: { name: type.emoji } };
  }
  return button;
}

function byButtonOrder(a: PanelTicketType, b: PanelTicketType): number {
  if (a.buttonOrder !== b.buttonOrder) return a.buttonOrder - b.buttonOrder;
  // Stable secondary sort by name to make tests deterministic.
  return a.name.localeCompare(b.name);
}
