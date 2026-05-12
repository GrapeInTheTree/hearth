import type { ReactionRolesOption, ReactionRolesPanel } from '@hearth/database';
import type { Branding, ReactionRolesMessagePayload } from '@hearth/tickets-core';
import type { APIEmbed } from 'discord-api-types/v10';

// Reaction-roles message payload — embed-only, no component row. The UI
// is the bot's pre-added reactions on the message itself; users figure
// the emoji ↔ role mapping out from the operator's embedDescription
// and the flag itself. PM asked (2026-05-12) to drop the auto-generated
// option line list under the description — it duplicated info already
// visible through the reactions and made the message noisy.
//
// Operators can still see the option ↔ role binding on the panel detail
// dashboard page (Options list with role pills); users see only what
// the embedDescription says, then react.
//
// Output is plain JSON (discord-api-types shapes) so this module — and
// transitively all of @hearth/reaction-roles-core — never imports the
// discord.js runtime. The bot's djs gateway implementation passes the
// JSON straight through to channel.send({ embeds }).

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

  const embed: APIEmbed = {
    title: panel.embedTitle,
    description: panel.embedDescription,
    color: branding.color,
  };

  return {
    content: undefined,
    embeds: [embed],
    components: [],
    reactions: ordered.map((o) => o.emoji),
  };
}
