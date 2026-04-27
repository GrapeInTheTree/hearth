import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

import { encode } from './customId.js';

// Panel message components: a single "Open ticket" button. The button's
// customId encodes (panelId, typeId) so the panel-open handler can route
// directly to the right type without a per-deployment lookup table.
//
// Mirrors the pattern in welcomeBuilder.ts: pure builder, no discord.js
// types leaking into services/.

export interface PanelButtonInput {
  readonly panelId: string;
  readonly typeId: string;
  readonly emoji: string;
  readonly label: string;
}

export function buildPanelComponents(
  input: PanelButtonInput,
): ReturnType<ActionRowBuilder<ButtonBuilder>['toJSON']>[] {
  const open = new ButtonBuilder()
    .setCustomId(encode('panel:open', { panelId: input.panelId, typeId: input.typeId }))
    .setLabel(input.label)
    .setEmoji(input.emoji)
    .setStyle(ButtonStyle.Success);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(open);
  return [row.toJSON()];
}
