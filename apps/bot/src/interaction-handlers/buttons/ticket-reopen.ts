import { decode, matchesAction } from '@discord-bot/tickets-core';
import { InteractionHandler, InteractionHandlerTypes } from '@sapphire/framework';
import type { ButtonInteraction } from 'discord.js';

import { readMemberRoleIds, replyAppError } from '../../lib/interactionHelpers.js';

interface ReopenPayload {
  readonly ticketId: string;
}

export class TicketReopenHandler extends InteractionHandler {
  public constructor(
    context: InteractionHandler.LoaderContext,
    options: InteractionHandler.Options,
  ) {
    super(context, { ...options, interactionHandlerType: InteractionHandlerTypes.Button });
  }

  public override parse(interaction: ButtonInteraction) {
    if (!matchesAction(interaction.customId, 'ticket:reopen')) return this.none();
    try {
      return this.some<ReopenPayload>(decode(interaction.customId, 'ticket:reopen'));
    } catch (err) {
      this.container.logger.warn('ticket-reopen: malformed customId', err);
      return this.none();
    }
  }

  public async run(interaction: ButtonInteraction, payload: ReopenPayload): Promise<void> {
    const result = await this.container.services.ticket.reopenTicket({
      ticketId: payload.ticketId,
      actorId: interaction.user.id,
      actorRoleIds: readMemberRoleIds(interaction),
    });
    if (!result.ok) {
      await replyAppError(interaction, result.error);
      return;
    }
    await interaction.deferUpdate();
  }
}
