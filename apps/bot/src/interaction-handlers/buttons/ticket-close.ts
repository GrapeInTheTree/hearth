import { decode, matchesAction } from '@hearth/tickets-core';
import { InteractionHandler, InteractionHandlerTypes } from '@sapphire/framework';
import type { ButtonInteraction } from 'discord.js';

import { readMemberRoleIds, replyAppError } from '../../lib/interactionHelpers.js';

interface ClosePayload {
  readonly ticketId: string;
}

// Close: opener-or-support. Service handles the permission split internally
// so we don't duplicate role logic here.
export class TicketCloseHandler extends InteractionHandler {
  public constructor(
    context: InteractionHandler.LoaderContext,
    options: InteractionHandler.Options,
  ) {
    super(context, { ...options, interactionHandlerType: InteractionHandlerTypes.Button });
  }

  public override parse(interaction: ButtonInteraction) {
    if (!matchesAction(interaction.customId, 'ticket:close')) return this.none();
    try {
      return this.some<ClosePayload>(decode(interaction.customId, 'ticket:close'));
    } catch (err) {
      this.container.logger.warn('ticket-close: malformed customId', err);
      return this.none();
    }
  }

  public async run(interaction: ButtonInteraction, payload: ClosePayload): Promise<void> {
    const result = await this.container.services.ticket.closeTicket({
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
