import { decode, matchesAction } from '@hearth/tickets-core';
import { InteractionHandler, InteractionHandlerTypes } from '@sapphire/framework';
import type { ButtonInteraction } from 'discord.js';

import { readMemberRoleIds, replyAppError } from '../../lib/interactionHelpers.js';

interface ClaimPayload {
  readonly ticketId: string;
}

export class TicketClaimHandler extends InteractionHandler {
  public constructor(
    context: InteractionHandler.LoaderContext,
    options: InteractionHandler.Options,
  ) {
    super(context, { ...options, interactionHandlerType: InteractionHandlerTypes.Button });
  }

  public override parse(interaction: ButtonInteraction) {
    if (!matchesAction(interaction.customId, 'ticket:claim')) return this.none();
    try {
      return this.some<ClaimPayload>(decode(interaction.customId, 'ticket:claim'));
    } catch (err) {
      this.container.logger.warn('ticket-claim: malformed customId', err);
      return this.none();
    }
  }

  public async run(interaction: ButtonInteraction, payload: ClaimPayload): Promise<void> {
    const result = await this.container.services.ticket.claimTicket({
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
