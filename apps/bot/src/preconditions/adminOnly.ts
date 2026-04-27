import { Precondition } from '@sapphire/framework';
import { type ChatInputCommandInteraction, PermissionFlagsBits } from 'discord.js';

import { i18n } from '../i18n/index.js';

/**
 * Sapphire precondition gating commands behind ManageGuild. The check looks
 * at the resolved interaction.memberPermissions bitfield (post-overwrites)
 * rather than role membership — that way an admin who relies on a role
 * grant or a per-channel allow still passes, and a user with the role but
 * a per-channel deny correctly fails.
 *
 * The Sapphire built-in 'GuildOnly' precondition handles the guild-context
 * guard (we declare both on commands that need them).
 */
export class AdminOnlyPrecondition extends Precondition {
  public override chatInputRun(interaction: ChatInputCommandInteraction): Precondition.Result {
    if (interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) === true) {
      return this.ok();
    }
    return this.error({
      identifier: 'AdminOnly',
      message: i18n.tickets.errors.notAdmin,
    });
  }
}

declare module '@sapphire/framework' {
  interface Preconditions {
    AdminOnly: never;
  }
}
