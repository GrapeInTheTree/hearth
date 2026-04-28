import { PermissionError } from '@hearth/shared';
import { decode, encode, matchesAction } from '@hearth/tickets-core';
import { hasManageGuild } from '@hearth/tickets-core';
import { InteractionHandler, InteractionHandlerTypes } from '@sapphire/framework';
import {
  ActionRowBuilder,
  type ButtonInteraction,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';

import { i18n } from '../../i18n/index.js';
import { readMemberPermissionsBits, replyAppError } from '../../lib/interactionHelpers.js';

interface DeletePayload {
  readonly ticketId: string;
}

// Delete is gated upfront because we don't want non-admins to even see the
// confirm modal flicker. The actual permission check happens again in the
// service layer (defense-in-depth) so a custom client can't bypass the UI gate.
const CONFIRM_INPUT_ID = 'confirm';
const REQUIRED_TOKEN = 'DELETE';

export class TicketDeleteHandler extends InteractionHandler {
  public constructor(
    context: InteractionHandler.LoaderContext,
    options: InteractionHandler.Options,
  ) {
    super(context, { ...options, interactionHandlerType: InteractionHandlerTypes.Button });
  }

  public override parse(interaction: ButtonInteraction) {
    if (!matchesAction(interaction.customId, 'ticket:delete')) return this.none();
    try {
      return this.some<DeletePayload>(decode(interaction.customId, 'ticket:delete'));
    } catch (err) {
      this.container.logger.warn('ticket-delete: malformed customId', err);
      return this.none();
    }
  }

  public async run(interaction: ButtonInteraction, payload: DeletePayload): Promise<void> {
    if (!hasManageGuild(readMemberPermissionsBits(interaction))) {
      await replyAppError(interaction, new PermissionError(i18n.tickets.errors.notAdmin));
      return;
    }

    // discord.js v14.26 deprecated TextInputBuilder.setLabel + ModalBuilder.addComponents
    // in favor of Components V2 builders. We're on legacy embeds (per CLAUDE.md §2)
    // until v1 stabilizes, so the old API is still the right one here.
    /* eslint-disable @typescript-eslint/no-deprecated */
    const confirmInput = new TextInputBuilder()
      .setCustomId(CONFIRM_INPUT_ID)
      .setLabel(`Type ${REQUIRED_TOKEN} to confirm`)
      .setStyle(TextInputStyle.Short)
      .setMinLength(REQUIRED_TOKEN.length)
      .setMaxLength(REQUIRED_TOKEN.length)
      .setRequired(true);

    const modal = new ModalBuilder()
      .setCustomId(encode('ticket:delete-confirm', { ticketId: payload.ticketId }))
      .setTitle('Delete ticket')
      .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(confirmInput));
    /* eslint-enable @typescript-eslint/no-deprecated */

    await interaction.showModal(modal);
  }
}

export const DELETE_CONFIRM_TOKEN = REQUIRED_TOKEN;
export const DELETE_CONFIRM_INPUT_ID = CONFIRM_INPUT_ID;
