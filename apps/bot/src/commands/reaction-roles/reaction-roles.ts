import { ConflictError, NotFoundError, ValidationError } from '@hearth/shared';
import { Command } from '@sapphire/framework';
import { ChannelType, MessageFlags } from 'discord.js';

import { i18n } from '../../i18n/index.js';

/**
 * /reactionroles — admin-only management of reaction-based reaction-roles panels.
 *
 * Sub-tree:
 *   /reactionroles create … — create a placeholder panel
 *   /reactionroles edit … — edit panel metadata
 *   /reactionroles delete panel — drop panel + Discord message
 *   /reactionroles list — show panels in this guild
 *   /reactionroles repost panel — drop existing message + post a fresh one (re-seeds reactions)
 *   /reactionroles option add … — add an emoji-role binding (≤10 per panel)
 *   /reactionroles option edit option … — patch option fields
 *   /reactionroles option remove option — drop a binding (role grants on existing users stay)
 *
 * No set-correct (every option is valid) and no buttonStyle (reaction UI).
 * Discord caps slash commands at 25 subcommands per top-level — we use 8.
 */
export class ReactionRolesCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, {
      ...options,
      name: 'reactionroles',
      description: 'Manage reaction-roles panels (admin only).',
      preconditions: ['GuildOnly', 'AdminOnly'],
    });
  }

  public override registerApplicationCommands(registry: Command.Registry): void {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName('reactionroles')
        .setDescription('Manage reaction-roles panels (admin only).')
        .addSubcommand((sub) =>
          sub
            .setName('create')
            .setDescription('Create a reaction-roles panel placeholder in a channel.')
            .addChannelOption((opt) =>
              opt
                .setName('channel')
                .setDescription('Channel where the reaction-roles message will live.')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(true),
            )
            .addStringOption((opt) =>
              opt
                .setName('title')
                .setDescription('Embed title (defaults to "Select your roles").')
                .setMaxLength(256)
                .setRequired(false),
            )
            .addStringOption((opt) =>
              opt
                .setName('description')
                .setDescription('Embed body text. Multi-line OK.')
                .setMaxLength(4000)
                .setRequired(false),
            ),
        )
        .addSubcommand((sub) =>
          sub
            .setName('edit')
            .setDescription('Edit reaction-roles panel metadata.')
            .addStringOption((opt) =>
              opt.setName('panel').setDescription('Panel ID.').setRequired(true),
            )
            .addChannelOption((opt) =>
              opt
                .setName('channel')
                .setDescription('Move panel to a different channel.')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(false),
            )
            .addStringOption((opt) =>
              opt
                .setName('title')
                .setDescription('New embed title.')
                .setMaxLength(256)
                .setRequired(false),
            )
            .addStringOption((opt) =>
              opt
                .setName('description')
                .setDescription('New embed body text.')
                .setMaxLength(4000)
                .setRequired(false),
            ),
        )
        .addSubcommand((sub) =>
          sub
            .setName('delete')
            .setDescription('Delete a reaction-roles panel and its Discord message.')
            .addStringOption((opt) =>
              opt.setName('panel').setDescription('Panel ID.').setRequired(true),
            ),
        )
        .addSubcommand((sub) =>
          sub
            .setName('list')
            .setDescription('List all reaction-roles panels configured in this server.'),
        )
        .addSubcommand((sub) =>
          sub
            .setName('repost')
            .setDescription(
              'Drop the existing reaction-roles message and post a fresh one (re-seeds reactions).',
            )
            .addStringOption((opt) =>
              opt.setName('panel').setDescription('Panel ID.').setRequired(true),
            ),
        )
        .addSubcommandGroup((group) =>
          group
            .setName('option')
            .setDescription('Manage individual emoji-role bindings on a reaction-roles panel.')
            .addSubcommand((sub) =>
              sub
                .setName('add')
                .setDescription('Add an emoji → role binding to a reaction-roles panel (≤10).')
                .addStringOption((opt) =>
                  opt
                    .setName('panel')
                    .setDescription('Panel ID (see /reactionroles list).')
                    .setRequired(true),
                )
                .addStringOption((opt) =>
                  opt
                    .setName('label')
                    .setDescription('Display name in the embed body, e.g. "English".')
                    .setMaxLength(80)
                    .setRequired(true),
                )
                .addStringOption((opt) =>
                  opt
                    .setName('emoji')
                    .setDescription('Unicode flag like 🇺🇸 or custom <:name:id>.')
                    .setMaxLength(64)
                    .setRequired(true),
                )
                .addRoleOption((opt) =>
                  opt
                    .setName('role')
                    .setDescription('Role granted while the reaction is held.')
                    .setRequired(true),
                )
                .addIntegerOption((opt) =>
                  opt
                    .setName('position')
                    .setDescription('Slot 0-19 (left-to-right). Must be unique per panel.')
                    .setMinValue(0)
                    .setMaxValue(19)
                    .setRequired(true),
                ),
            )
            .addSubcommand((sub) =>
              sub
                .setName('edit')
                .setDescription('Update fields of an existing reaction-roles option.')
                .addStringOption((opt) =>
                  opt.setName('option').setDescription('Option ID.').setRequired(true),
                )
                .addStringOption((opt) =>
                  opt
                    .setName('label')
                    .setDescription('New label.')
                    .setMaxLength(80)
                    .setRequired(false),
                )
                .addStringOption((opt) =>
                  opt
                    .setName('emoji')
                    .setDescription('New emoji.')
                    .setMaxLength(64)
                    .setRequired(false),
                )
                .addRoleOption((opt) =>
                  opt.setName('role').setDescription('Replace target role.').setRequired(false),
                )
                .addIntegerOption((opt) =>
                  opt
                    .setName('position')
                    .setDescription('New slot 0-19.')
                    .setMinValue(0)
                    .setMaxValue(19)
                    .setRequired(false),
                ),
            )
            .addSubcommand((sub) =>
              sub
                .setName('remove')
                .setDescription('Remove a reaction-roles option.')
                .addStringOption((opt) =>
                  opt.setName('option').setDescription('Option ID.').setRequired(true),
                ),
            ),
        ),
    );
  }

  public override async chatInputRun(
    interaction: Command.ChatInputCommandInteraction,
  ): Promise<void> {
    if (interaction.guildId === null) return;
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand(true);

    if (group === 'option') {
      switch (sub) {
        case 'add':
          await this.runOptionAdd(interaction);
          return;
        case 'edit':
          await this.runOptionEdit(interaction);
          return;
        case 'remove':
          await this.runOptionRemove(interaction);
          return;
      }
    }

    switch (sub) {
      case 'create':
        await this.runCreate(interaction);
        return;
      case 'edit':
        await this.runEdit(interaction);
        return;
      case 'delete':
        await this.runDelete(interaction);
        return;
      case 'list':
        await this.runList(interaction);
        return;
      case 'repost':
        await this.runRepost(interaction);
        return;
    }
  }

  private async runCreate(interaction: Command.ChatInputCommandInteraction): Promise<void> {
    if (interaction.guildId === null) return;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const channel = interaction.options.getChannel('channel', true);
    const title = interaction.options.getString('title', false) ?? undefined;
    const description = interaction.options.getString('description', false) ?? undefined;

    const result = await this.container.services.reactionRoles.createPanel({
      guildId: interaction.guildId,
      channelId: channel.id,
      ...(title !== undefined ? { embedTitle: title } : {}),
      ...(description !== undefined ? { embedDescription: description } : {}),
    });
    if (!result.ok) {
      await interaction.editReply({ content: result.error.message });
      return;
    }
    await interaction.editReply({
      content: `Created reaction-roles panel for <#${channel.id}>. (Panel ID: \`${result.value.panel.id}\`)\nNext: \`/reactionroles option add panel:${result.value.panel.id}\` to add options, then \`/reactionroles repost\` to publish.`,
    });
  }

  private async runEdit(interaction: Command.ChatInputCommandInteraction): Promise<void> {
    if (interaction.guildId === null) return;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const panelId = interaction.options.getString('panel', true);
    const channel = interaction.options.getChannel('channel', false);
    const title = interaction.options.getString('title', false);
    const description = interaction.options.getString('description', false);

    const result = await this.container.services.reactionRoles.editPanel(panelId, {
      ...(channel !== null ? { channelId: channel.id } : {}),
      ...(title !== null ? { embedTitle: title } : {}),
      ...(description !== null ? { embedDescription: description } : {}),
    });
    if (!result.ok) {
      await interaction.editReply({ content: result.error.message });
      return;
    }
    await interaction.editReply({
      content: `Updated reaction-roles panel \`${panelId}\`. Run \`/reactionroles repost\` to publish.`,
    });
  }

  private async runDelete(interaction: Command.ChatInputCommandInteraction): Promise<void> {
    if (interaction.guildId === null) return;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const panelId = interaction.options.getString('panel', true);
    const result = await this.container.services.reactionRoles.deletePanel(panelId);
    if (!result.ok) {
      const message =
        result.error instanceof NotFoundError ? result.error.message : i18n.common.errors.generic;
      await interaction.editReply({ content: message });
      return;
    }
    await interaction.editReply({ content: `Deleted reaction-roles panel \`${panelId}\`.` });
  }

  private async runList(interaction: Command.ChatInputCommandInteraction): Promise<void> {
    if (interaction.guildId === null) return;
    const panels = await this.container.services.reactionRoles.listPanels(interaction.guildId);
    if (panels.length === 0) {
      await interaction.reply({
        content: 'No reaction-roles panels configured yet. Use `/reactionroles create` to add one.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const lines = [
      '**Configured reaction-roles panels:**',
      ...panels.map(
        (p) => `• <#${p.channelId}> — \`${p.id}\` (${String(p.options.length)} option(s))`,
      ),
    ];
    await interaction.reply({
      content: lines.join('\n'),
      flags: MessageFlags.Ephemeral,
    });
  }

  private async runRepost(interaction: Command.ChatInputCommandInteraction): Promise<void> {
    if (interaction.guildId === null) return;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const panelId = interaction.options.getString('panel', true);
    const result = await this.container.services.reactionRoles.repostPanel(panelId);
    if (!result.ok) {
      await interaction.editReply({ content: result.error.message });
      return;
    }
    await interaction.editReply({
      content: `Reposted reaction-roles panel \`${panelId}\`. New message: \`${result.value.messageId}\`.`,
    });
  }

  private async runOptionAdd(interaction: Command.ChatInputCommandInteraction): Promise<void> {
    if (interaction.guildId === null) return;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const panelId = interaction.options.getString('panel', true);
    const label = interaction.options.getString('label', true);
    const emoji = interaction.options.getString('emoji', true);
    const role = interaction.options.getRole('role', true);
    const position = interaction.options.getInteger('position', true);

    const result = await this.container.services.reactionRoles.addOption(panelId, {
      label,
      emoji,
      roleId: role.id,
      position,
    });
    if (!result.ok) {
      const message =
        result.error instanceof ConflictError ||
        result.error instanceof NotFoundError ||
        result.error instanceof ValidationError
          ? result.error.message
          : i18n.common.errors.generic;
      await interaction.editReply({ content: message });
      return;
    }
    await interaction.editReply({
      content: `Added option \`${result.value.id}\` (${emoji} **${label}** → <@&${role.id}>, slot ${String(position)}) to panel \`${panelId}\`. Run \`/reactionroles repost\` to publish.`,
    });
  }

  private async runOptionEdit(interaction: Command.ChatInputCommandInteraction): Promise<void> {
    if (interaction.guildId === null) return;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const optionId = interaction.options.getString('option', true);
    const label = interaction.options.getString('label', false);
    const emoji = interaction.options.getString('emoji', false);
    const role = interaction.options.getRole('role', false);
    const position = interaction.options.getInteger('position', false);

    const result = await this.container.services.reactionRoles.editOption(optionId, {
      ...(label !== null ? { label } : {}),
      ...(emoji !== null ? { emoji } : {}),
      ...(role !== null ? { roleId: role.id } : {}),
      ...(position !== null ? { position } : {}),
    });
    if (!result.ok) {
      await interaction.editReply({ content: result.error.message });
      return;
    }
    await interaction.editReply({ content: `Updated option \`${optionId}\`.` });
  }

  private async runOptionRemove(interaction: Command.ChatInputCommandInteraction): Promise<void> {
    if (interaction.guildId === null) return;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const optionId = interaction.options.getString('option', true);
    const result = await this.container.services.reactionRoles.removeOption(optionId);
    if (!result.ok) {
      await interaction.editReply({ content: result.error.message });
      return;
    }
    await interaction.editReply({ content: `Removed option \`${optionId}\`.` });
  }
}
