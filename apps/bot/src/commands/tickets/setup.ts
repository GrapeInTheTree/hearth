import { Command } from '@sapphire/framework';
import { ChannelType, MessageFlags } from 'discord.js';

import { i18n } from '../../i18n/index.js';

export class SetupCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, {
      ...options,
      description: 'Configure ticket system settings (admin only).',
      preconditions: ['GuildOnly', 'AdminOnly'],
    });
  }

  public override registerApplicationCommands(registry: Command.Registry): void {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName('setup')
        .setDescription('Configure ticket system settings (admin only).')
        .addSubcommand((sub) =>
          sub
            .setName('archive-category')
            .setDescription('Set the category that closed tickets are moved to.')
            .addChannelOption((opt) =>
              opt
                .setName('category')
                .setDescription('Discord category for archived tickets (e.g. "Database").')
                .addChannelTypes(ChannelType.GuildCategory)
                .setRequired(true),
            ),
        )
        .addSubcommand((sub) =>
          sub
            .setName('log-channel')
            .setDescription('Set the channel where ticket-delete events are logged.')
            .addChannelOption((opt) =>
              opt
                .setName('channel')
                .setDescription('Text channel for modlog summaries.')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(true),
            ),
        )
        .addSubcommand((sub) =>
          sub.setName('show').setDescription('Show the current ticket system configuration.'),
        ),
    );
  }

  public override async chatInputRun(
    interaction: Command.ChatInputCommandInteraction,
  ): Promise<void> {
    if (interaction.guildId === null) return; // GuildOnly precondition guards this.
    const sub = interaction.options.getSubcommand(true);

    switch (sub) {
      case 'archive-category': {
        const category = interaction.options.getChannel('category', true);
        const result = await this.container.services.guildConfig.setArchiveCategory(
          interaction.guildId,
          category.id,
        );
        if (!result.ok) {
          await interaction.reply({
            content: result.error.message,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        await interaction.reply({
          content: `Archive category set to <#${category.id}>.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      case 'log-channel': {
        const channel = interaction.options.getChannel('channel', true);
        const result = await this.container.services.guildConfig.setLogChannel(
          interaction.guildId,
          channel.id,
        );
        if (!result.ok) {
          await interaction.reply({
            content: result.error.message,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        await interaction.reply({
          content: `Log channel set to <#${channel.id}>.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      case 'show': {
        const config = await this.container.services.guildConfig.getOrCreate(interaction.guildId);
        const lines = [
          `**Ticket configuration for this server**`,
          `• Archive category: ${config.archiveCategoryId !== null ? `<#${config.archiveCategoryId}>` : '_unset_'}`,
          `• Log channel: ${config.alertChannelId !== null ? `<#${config.alertChannelId}>` : '_unset_'}`,
          `• Tickets opened so far: ${String(config.ticketCounter)}`,
          `• Default locale: ${config.defaultLocale}`,
        ];
        await interaction.reply({
          content: lines.join('\n'),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      default: {
        await interaction.reply({
          content: i18n.common.errors.generic,
          flags: MessageFlags.Ephemeral,
        });
      }
    }
  }
}
