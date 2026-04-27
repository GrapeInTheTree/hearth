import { ConflictError, NotFoundError, PermissionError } from '@discord-bot/shared';
import { InteractionHandler, InteractionHandlerTypes } from '@sapphire/framework';
import { type ModalSubmitInteraction, MessageFlags } from 'discord.js';

import { i18n } from '../../i18n/index.js';
import { decode, matchesAction } from '../../lib/customId.js';
import { readMemberPermissionsBits } from '../../lib/interactionHelpers.js';
import { DELETE_CONFIRM_INPUT_ID, DELETE_CONFIRM_TOKEN } from '../buttons/ticket-delete.js';

interface DeleteConfirmPayload {
  readonly ticketId: string;
}

// Modal handler that validates the confirmation text and invokes
// ticketService.deleteTicket. Replies ephemerally because by the time
// we reply the channel itself has been deleted — non-ephemeral would
// have nowhere to land.
export class TicketDeleteConfirmHandler extends InteractionHandler {
  public constructor(
    context: InteractionHandler.LoaderContext,
    options: InteractionHandler.Options,
  ) {
    super(context, { ...options, interactionHandlerType: InteractionHandlerTypes.ModalSubmit });
  }

  public override parse(interaction: ModalSubmitInteraction) {
    if (!matchesAction(interaction.customId, 'ticket:delete-confirm')) return this.none();
    try {
      return this.some<DeleteConfirmPayload>(decode(interaction.customId, 'ticket:delete-confirm'));
    } catch (err) {
      this.container.logger.warn('ticket-delete-confirm: malformed customId', err);
      return this.none();
    }
  }

  public async run(
    interaction: ModalSubmitInteraction,
    payload: DeleteConfirmPayload,
  ): Promise<void> {
    const typed = interaction.fields.getTextInputValue(DELETE_CONFIRM_INPUT_ID).trim();
    if (typed !== DELETE_CONFIRM_TOKEN) {
      await interaction.reply({
        content: `Confirmation failed — you must type **${DELETE_CONFIRM_TOKEN}** exactly.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // We deferReply ephemeral because deleteTicket on the current channel
    // means the interaction's channel no longer exists by the time we reply;
    // ephemeral replies survive channel deletion.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const result = await this.container.services.ticket.deleteTicket({
      ticketId: payload.ticketId,
      actorId: interaction.user.id,
      actorPermissionsBits: readMemberPermissionsBits(interaction),
    });

    if (!result.ok) {
      const message =
        result.error instanceof PermissionError ||
        result.error instanceof ConflictError ||
        result.error instanceof NotFoundError
          ? result.error.message
          : i18n.common.errors.generic;
      await interaction.editReply({ content: message });
      return;
    }
    await interaction.editReply({ content: 'Ticket deleted.' });
  }
}
