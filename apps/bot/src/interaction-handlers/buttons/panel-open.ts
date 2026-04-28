import { ConflictError, NotFoundError } from '@hearth/shared';
import { decode, matchesAction } from '@hearth/tickets-core';
import { InteractionHandler, InteractionHandlerTypes } from '@sapphire/framework';
import { type ButtonInteraction, MessageFlags } from 'discord.js';

import { format, i18n } from '../../i18n/index.js';

interface PanelOpenPayload {
  readonly panelId: string;
  readonly typeId: string;
}

// Routes the "Open ticket" button click to TicketService.openTicket. The
// reply has to be ephemeral-deferred immediately because Discord's
// 3-second response window is shorter than channel creation under load.
//
// On success we edit the reply with a clickable link to the new ticket
// channel. On any AppError we surface error.message — services already
// resolved it to an i18n string, so this handler doesn't switch on
// error.code to decide what to show.
export class PanelOpenHandler extends InteractionHandler {
  public constructor(
    context: InteractionHandler.LoaderContext,
    options: InteractionHandler.Options,
  ) {
    super(context, { ...options, interactionHandlerType: InteractionHandlerTypes.Button });
  }

  public override parse(interaction: ButtonInteraction) {
    if (!matchesAction(interaction.customId, 'panel:open')) return this.none();
    try {
      const payload: PanelOpenPayload = decode(interaction.customId, 'panel:open');
      return this.some(payload);
    } catch (err) {
      this.container.logger.warn('panel-open: malformed customId', err);
      return this.none();
    }
  }

  public async run(interaction: ButtonInteraction, payload: PanelOpenPayload): Promise<void> {
    if (interaction.guildId === null) return;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const member = interaction.member;
    const username =
      typeof member === 'object' && member !== null && 'displayName' in member
        ? ((member as { displayName?: string }).displayName ?? interaction.user.username)
        : interaction.user.username;

    const result = await this.container.services.ticket.openTicket({
      guildId: interaction.guildId,
      openerId: interaction.user.id,
      openerUsername: username,
      panelId: payload.panelId,
      typeId: payload.typeId,
    });

    if (!result.ok) {
      const message =
        result.error instanceof ConflictError || result.error instanceof NotFoundError
          ? result.error.message
          : i18n.common.errors.generic;
      await interaction.editReply({ content: message });
      return;
    }

    await interaction.editReply({
      content: format(i18n.tickets.openSuccess, { channel: `<#${result.value.channelId}>` }),
    });
  }
}
