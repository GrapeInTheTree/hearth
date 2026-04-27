import { Command } from '@sapphire/framework';
import { ChannelType, MessageFlags } from 'discord.js';

import { i18n } from '../../i18n/index.js';
import type { PanelType, UpsertPanelInput } from '../../services/panelService.js';

const PANEL_TYPES: readonly PanelType[] = ['support', 'offer'];

export class PanelCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, {
      ...options,
      description: 'Manage ticket panels (admin only).',
      preconditions: ['GuildOnly', 'AdminOnly'],
    });
  }

  public override registerApplicationCommands(registry: Command.Registry): void {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName('panel')
        .setDescription('Manage ticket panels (admin only).')
        .addSubcommand((sub) =>
          sub
            .setName('create')
            .setDescription('Create or update a panel in a channel.')
            .addChannelOption((opt) =>
              opt
                .setName('channel')
                .setDescription('Channel where the panel message will live.')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(true),
            )
            .addStringOption((opt) =>
              opt
                .setName('type')
                .setDescription('Ticket type the panel opens.')
                .setRequired(true)
                .addChoices(
                  { name: 'Support', value: 'support' },
                  { name: 'Offer', value: 'offer' },
                ),
            ),
        )
        .addSubcommand((sub) =>
          sub.setName('list').setDescription('List all configured panels in this server.'),
        ),
    );
  }

  public override async chatInputRun(
    interaction: Command.ChatInputCommandInteraction,
  ): Promise<void> {
    if (interaction.guildId === null) return;
    const sub = interaction.options.getSubcommand(true);
    if (sub === 'create') {
      await this.runCreate(interaction);
      return;
    }
    if (sub === 'list') {
      await this.runList(interaction);
      return;
    }
  }

  private async runCreate(interaction: Command.ChatInputCommandInteraction): Promise<void> {
    if (interaction.guildId === null) return;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const channel = interaction.options.getChannel('channel', true);
    const typeRaw = interaction.options.getString('type', true);
    if (!isPanelType(typeRaw)) {
      await interaction.editReply({ content: i18n.common.errors.generic });
      return;
    }
    const type = typeRaw;

    const env = this.container.env;
    const activeCategoryId = env.TICKET_ACTIVE_CATEGORY_ID;
    if (activeCategoryId === undefined) {
      await interaction.editReply({ content: i18n.tickets.errors.notConfigured });
      return;
    }

    const supportRoleIds = env.TICKET_SUPPORT_ROLE_IDS;
    const pingRoleIds =
      type === 'support' ? env.TICKET_SUPPORT_MENTION_ROLE_IDS : env.TICKET_OFFER_MENTION_ROLE_IDS;

    // Resolve cross-ref to the other panel's channel id (env-injected). When the
    // counterpart isn't yet configured we leave the placeholder visible — operator
    // signal to finish setup.
    const otherChannelId =
      type === 'support' ? env.TICKET_OFFER_PANEL_CHANNEL_ID : env.TICKET_SUPPORT_PANEL_CHANNEL_ID;

    const input: UpsertPanelInput = {
      guildId: interaction.guildId,
      channelId: channel.id,
      type,
      activeCategoryId,
      supportRoleIds,
      pingRoleIds,
      perUserLimit: 1,
      ...(otherChannelId !== undefined ? { otherPanelChannelId: otherChannelId } : {}),
    };

    const result = await this.container.services.panel.upsertPanel(input);
    if (!result.ok) {
      await interaction.editReply({ content: result.error.message });
      return;
    }

    const verb = result.value.created ? 'Created' : 'Updated';
    await interaction.editReply({
      content: `${verb} ${type} panel in <#${channel.id}>. (Panel ID: \`${result.value.panel.id}\`)`,
    });
  }

  private async runList(interaction: Command.ChatInputCommandInteraction): Promise<void> {
    if (interaction.guildId === null) return;
    const panels = await this.container.services.panel.listPanels(interaction.guildId);
    if (panels.length === 0) {
      await interaction.reply({
        content: 'No panels configured yet. Use `/panel create` to add one.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const lines = [
      '**Configured panels:**',
      ...panels.map((p) => `• <#${p.channelId}> — \`${p.id}\` (${p.embedTitle})`),
    ];
    await interaction.reply({
      content: lines.join('\n'),
      flags: MessageFlags.Ephemeral,
    });
  }
}

function isPanelType(value: string): value is PanelType {
  return (PANEL_TYPES as readonly string[]).includes(value);
}
