import type { ReactionRolesOption, ReactionRolesPanel } from '@hearth/database';
import type { Branding, ReactionRolesMessagePayload } from '@hearth/tickets-core';
import type { APIEmbed } from 'discord-api-types/v10';

import { reactionRoles as i18n } from '../i18n/index.js';

// Self-roles message payload — embed-only, no component row. The UI is the
// bot's pre-added reactions on the message itself. Each option contributes
// one line to the embed body that names the emoji, the label, and the role
// mention so users can see "what does each flag give me" without clicking.
//
// Output is plain JSON (discord-api-types shapes) so this module — and
// transitively all of @hearth/reaction-roles-core — never imports the
// discord.js runtime. The bot's djs gateway implementation passes the JSON
// straight through to channel.send({ embeds }).

export interface ReactionRolesPayload extends ReactionRolesMessagePayload {
  /** Emoji strings, ordered by position, ready to feed to
   *  gateway.syncBotReactions after the message is posted/edited. */
  readonly reactions: readonly string[];
}

export function buildReactionRolesPayload(
  panel: Pick<ReactionRolesPanel, 'embedTitle' | 'embedDescription'>,
  options: readonly ReactionRolesOption[],
  branding: Pick<Branding, 'color'>,
): ReactionRolesPayload {
  const ordered = [...options].sort((a, b) => a.position - b.position);
  const lines = ordered.map((o) => renderOptionLine(o));

  const description =
    lines.length > 0 ? [panel.embedDescription, '', ...lines].join('\n') : panel.embedDescription;

  const embed: APIEmbed = {
    title: panel.embedTitle,
    description,
    color: branding.color,
  };

  return {
    content: undefined,
    embeds: [embed],
    components: [],
    reactions: ordered.map((o) => o.emoji),
  };
}

function renderOptionLine(option: ReactionRolesOption): string {
  return i18n.optionLine
    .replace('{emoji}', option.emoji)
    .replace('{label}', option.label)
    .replace('{roleId}', option.roleId);
}
