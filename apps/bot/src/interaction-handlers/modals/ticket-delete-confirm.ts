import { ConflictError, NotFoundError, PermissionError } from '@hearth/shared';
import { decode, matchesAction } from '@hearth/tickets-core';
import { InteractionHandler, InteractionHandlerTypes } from '@sapphire/framework';
import { DiscordAPIError, type ModalSubmitInteraction, MessageFlags } from 'discord.js';

import { i18n } from '../../i18n/index.js';
import { readMemberPermissionsBits } from '../../lib/interactionHelpers.js';
import { DELETE_CONFIRM_INPUT_ID, DELETE_CONFIRM_TOKEN } from '../buttons/ticket-delete.js';

interface DeleteConfirmPayload {
  readonly ticketId: string;
}

// Modal handler that validates the confirmation text and invokes
// ticketService.deleteTicket. The trigger lives inside the ticket
// channel, so on success the channel — and with it the interaction's
// @original message — is gone by the time we'd acknowledge. Any
// editReply at that point 404s with code 10008 (Unknown Message).
// We attempt the edit anyway (channel-delete propagation can race in
// rare paths) and swallow the expected 10008.
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
      await this.safeEditReply(interaction, message);
      return;
    }
    await this.safeEditReply(interaction, 'Ticket deleted.');
  }

  // editReply that swallows the expected 10008 Unknown Message after
  // successful channel deletion. Any other Discord error still surfaces
  // so genuine bugs aren't hidden.
  private async safeEditReply(interaction: ModalSubmitInteraction, content: string): Promise<void> {
    try {
      await interaction.editReply({ content });
    } catch (err) {
      if (err instanceof DiscordAPIError && err.code === 10008) return;
      throw err;
    }
  }
}
