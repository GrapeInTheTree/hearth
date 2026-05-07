import { ConflictError, NotFoundError, ValidationError } from '@hearth/shared';
import { Command } from '@sapphire/framework';
import { ChannelType, MessageFlags } from 'discord.js';

import { i18n } from '../../i18n/index.js';

const BUTTON_STYLE_CHOICES = [
  { name: 'Primary (blue)', value: 'primary' },
  { name: 'Secondary (gray)', value: 'secondary' },
  { name: 'Success (green)', value: 'success' },
  { name: 'Danger (red)', value: 'danger' },
] as const;

type ButtonStyleChoice = (typeof BUTTON_STYLE_CHOICES)[number]['value'];

/**
 * /verification — admin-only management of verification panels.
 *
 * Sub-tree:
 *   /verification create … — create a placeholder panel
 *   /verification edit … — edit panel metadata
 *   /verification delete panel-id — drop panel + Discord message
 *   /verification list — show panels in this guild
 *   /verification repost panel-id — drop existing message + post a fresh one
 *   /verification set-correct panel-id option-id — mark the correct option
 *   /verification option add … — add a button (≤5 per panel)
 *   /verification option edit option-id … — patch option fields
 *   /verification option remove option-id — drop a non-correct option
 *
 * Discord caps slash commands at 25 subcommands per top-level — we use 9.
 */
export class VerificationCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, {
      ...options,
      description: 'Manage verification panels (admin only).',
      preconditions: ['GuildOnly', 'AdminOnly'],
    });
  }

  public override registerApplicationCommands(registry: Command.Registry): void {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName('verification')
        .setDescription('Manage verification panels (admin only).')
        .addSubcommand((sub) =>
          sub
            .setName('create')
            .setDescription('Create a verification panel placeholder in a channel.')
            .addChannelOption((opt) =>
              opt
                .setName('channel')
                .setDescription('Channel where the verification message will live.')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(true),
            )
            .addRoleOption((opt) =>
              opt
                .setName('role')
                .setDescription('Role granted on a correct submission.')
                .setRequired(true),
            )
            .addStringOption((opt) =>
              opt
                .setName('title')
                .setDescription('Embed title (defaults to "Verification").')
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
            .setDescription('Edit verification panel metadata.')
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
            .addRoleOption((opt) =>
              opt
                .setName('role')
                .setDescription('Replace the role granted on success.')
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
            .setDescription('Delete a verification panel and its Discord message.')
            .addStringOption((opt) =>
              opt.setName('panel').setDescription('Panel ID.').setRequired(true),
            ),
        )
        .addSubcommand((sub) =>
          sub
            .setName('list')
            .setDescription('List all verification panels configured in this server.'),
        )
        .addSubcommand((sub) =>
          sub
            .setName('repost')
            .setDescription('Drop the existing verification message and post a fresh one.')
            .addStringOption((opt) =>
              opt.setName('panel').setDescription('Panel ID.').setRequired(true),
            ),
        )
        .addSubcommand((sub) =>
          sub
            .setName('set-correct')
            .setDescription('Mark which option is the correct answer.')
            .addStringOption((opt) =>
              opt.setName('panel').setDescription('Panel ID.').setRequired(true),
            )
            .addStringOption((opt) =>
              opt.setName('option').setDescription('Option ID.').setRequired(true),
            ),
        )
        .addSubcommandGroup((group) =>
          group
            .setName('option')
            .setDescription('Manage individual buttons (options) on a verification panel.')
            .addSubcommand((sub) =>
              sub
                .setName('add')
                .setDescription('Add an emoji button to a verification panel (≤5 per panel).')
                .addStringOption((opt) =>
                  opt
                    .setName('panel')
                    .setDescription('Panel ID (see /verification list).')
                    .setRequired(true),
                )
                .addStringOption((opt) =>
                  opt
                    .setName('label')
                    .setDescription('Visible button text, e.g. "Apple".')
                    .setMaxLength(80)
                    .setRequired(true),
                )
                .addStringOption((opt) =>
                  opt
                    .setName('emoji')
                    .setDescription('Unicode emoji like 🍎 or custom <:name:id>.')
                    .setMaxLength(64)
                    .setRequired(true),
                )
                .addIntegerOption((opt) =>
                  opt
                    .setName('position')
                    .setDescription('Slot 0-4 (left-to-right). Must be unique per panel.')
                    .setMinValue(0)
                    .setMaxValue(4)
                    .setRequired(true),
                )
                .addStringOption((opt) =>
                  opt
                    .setName('button-style')
                    .setDescription('Button color (default: primary).')
                    .addChoices(...BUTTON_STYLE_CHOICES)
                    .setRequired(false),
                ),
            )
            .addSubcommand((sub) =>
              sub
                .setName('edit')
                .setDescription('Update fields of an existing verification option.')
                .addStringOption((opt) =>
                  opt.setName('option').setDescription('Option ID.').setRequired(true),
                )
                .addStringOption((opt) =>
                  opt
                    .setName('label')
                    .setDescription('New button label.')
                    .setMaxLength(80)
                    .setRequired(false),
                )
                .addStringOption((opt) =>
                  opt
                    .setName('emoji')
                    .setDescription('New button emoji.')
                    .setMaxLength(64)
                    .setRequired(false),
                )
                .addStringOption((opt) =>
                  opt
                    .setName('button-style')
                    .setDescription('New button color.')
                    .addChoices(...BUTTON_STYLE_CHOICES)
                    .setRequired(false),
                )
                .addIntegerOption((opt) =>
                  opt
                    .setName('position')
                    .setDescription('New slot 0-4.')
                    .setMinValue(0)
                    .setMaxValue(4)
                    .setRequired(false),
                ),
            )
            .addSubcommand((sub) =>
              sub
                .setName('remove')
                .setDescription('Remove a verification option (cannot remove the correct one).')
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
      case 'set-correct':
        await this.runSetCorrect(interaction);
        return;
    }
  }

  // ─────────────────────────── /verification create ───────────────────────────

  private async runCreate(interaction: Command.ChatInputCommandInteraction): Promise<void> {
    if (interaction.guildId === null) return;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const channel = interaction.options.getChannel('channel', true);
    const role = interaction.options.getRole('role', true);
    const title = interaction.options.getString('title', false) ?? undefined;
    const description = interaction.options.getString('description', false) ?? undefined;

    const result = await this.container.services.verification.createPanel({
      guildId: interaction.guildId,
      channelId: channel.id,
      roleId: role.id,
      ...(title !== undefined ? { embedTitle: title } : {}),
      ...(description !== undefined ? { embedDescription: description } : {}),
    });
    if (!result.ok) {
      await interaction.editReply({ content: result.error.message });
      return;
    }
    await interaction.editReply({
      content: `Created verification panel for <#${channel.id}>. (Panel ID: \`${result.value.panel.id}\`)\nNext: \`/verification option add panel:${result.value.panel.id}\` to add options, then \`/verification set-correct\` and \`/verification repost\`.`,
    });
  }

  // ─────────────────────────── /verification edit ───────────────────────────

  private async runEdit(interaction: Command.ChatInputCommandInteraction): Promise<void> {
    if (interaction.guildId === null) return;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const panelId = interaction.options.getString('panel', true);
    const channel = interaction.options.getChannel('channel', false);
    const role = interaction.options.getRole('role', false);
    const title = interaction.options.getString('title', false);
    const description = interaction.options.getString('description', false);

    const result = await this.container.services.verification.editPanel(panelId, {
      ...(channel !== null ? { channelId: channel.id } : {}),
      ...(role !== null ? { roleId: role.id } : {}),
      ...(title !== null ? { embedTitle: title } : {}),
      ...(description !== null ? { embedDescription: description } : {}),
    });
    if (!result.ok) {
      await interaction.editReply({ content: result.error.message });
      return;
    }
    await interaction.editReply({
      content: `Updated verification panel \`${panelId}\`. Run \`/verification repost\` to push changes to the channel message.`,
    });
  }

  // ─────────────────────────── /verification delete ───────────────────────────

  private async runDelete(interaction: Command.ChatInputCommandInteraction): Promise<void> {
    if (interaction.guildId === null) return;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const panelId = interaction.options.getString('panel', true);
    const result = await this.container.services.verification.deletePanel(panelId);
    if (!result.ok) {
      const message =
        result.error instanceof NotFoundError ? result.error.message : i18n.common.errors.generic;
      await interaction.editReply({ content: message });
      return;
    }
    await interaction.editReply({
      content: `Deleted verification panel \`${panelId}\`.`,
    });
  }

  // ─────────────────────────── /verification list ───────────────────────────

  private async runList(interaction: Command.ChatInputCommandInteraction): Promise<void> {
    if (interaction.guildId === null) return;
    const panels = await this.container.services.verification.listPanels(interaction.guildId);
    if (panels.length === 0) {
      await interaction.reply({
        content: 'No verification panels configured yet. Use `/verification create` to add one.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const lines = [
      '**Configured verification panels:**',
      ...panels.map((p) => {
        const correct =
          p.correctOptionId === null
            ? '⚠️ no correct option set'
            : `correct: \`${p.correctOptionId}\``;
        return `• <#${p.channelId}> — \`${p.id}\` (role <@&${p.roleId}>, ${String(p.options.length)} option(s), ${correct})`;
      }),
    ];
    await interaction.reply({
      content: lines.join('\n'),
      flags: MessageFlags.Ephemeral,
    });
  }

  // ─────────────────────────── /verification repost ───────────────────────────

  private async runRepost(interaction: Command.ChatInputCommandInteraction): Promise<void> {
    if (interaction.guildId === null) return;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const panelId = interaction.options.getString('panel', true);
    const result = await this.container.services.verification.repostPanel(panelId);
    if (!result.ok) {
      await interaction.editReply({ content: result.error.message });
      return;
    }
    await interaction.editReply({
      content: `Reposted verification panel \`${panelId}\`. New message: \`${result.value.messageId}\`.`,
    });
  }

  // ─────────────────────────── /verification set-correct ───────────────────────────

  private async runSetCorrect(interaction: Command.ChatInputCommandInteraction): Promise<void> {
    if (interaction.guildId === null) return;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const panelId = interaction.options.getString('panel', true);
    const optionId = interaction.options.getString('option', true);
    const result = await this.container.services.verification.setCorrectOption(panelId, optionId);
    if (!result.ok) {
      const message =
        result.error instanceof NotFoundError || result.error instanceof ValidationError
          ? result.error.message
          : i18n.common.errors.generic;
      await interaction.editReply({ content: message });
      return;
    }
    await interaction.editReply({
      content: `Marked option \`${optionId}\` as correct on panel \`${panelId}\`. Run \`/verification repost\` to publish.`,
    });
  }

  // ─────────────────── /verification option add/edit/remove ───────────────────

  private async runOptionAdd(interaction: Command.ChatInputCommandInteraction): Promise<void> {
    if (interaction.guildId === null) return;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const panelId = interaction.options.getString('panel', true);
    const label = interaction.options.getString('label', true);
    const emoji = interaction.options.getString('emoji', true);
    const position = interaction.options.getInteger('position', true);
    const buttonStyle = (interaction.options.getString('button-style', false) ??
      'primary') as ButtonStyleChoice;

    const result = await this.container.services.verification.addOption(panelId, {
      label,
      emoji,
      buttonStyle,
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
      content: `Added option \`${result.value.id}\` (label: **${label}**, slot ${String(position)}) to panel \`${panelId}\`.`,
    });
  }

  private async runOptionEdit(interaction: Command.ChatInputCommandInteraction): Promise<void> {
    if (interaction.guildId === null) return;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const optionId = interaction.options.getString('option', true);
    const label = interaction.options.getString('label', false);
    const emoji = interaction.options.getString('emoji', false);
    const buttonStyle = interaction.options.getString(
      'button-style',
      false,
    ) as ButtonStyleChoice | null;
    const position = interaction.options.getInteger('position', false);

    const result = await this.container.services.verification.editOption(optionId, {
      ...(label !== null ? { label } : {}),
      ...(emoji !== null ? { emoji } : {}),
      ...(buttonStyle !== null ? { buttonStyle } : {}),
      ...(position !== null ? { position } : {}),
    });
    if (!result.ok) {
      await interaction.editReply({ content: result.error.message });
      return;
    }
    await interaction.editReply({
      content: `Updated option \`${optionId}\`.`,
    });
  }

  private async runOptionRemove(interaction: Command.ChatInputCommandInteraction): Promise<void> {
    if (interaction.guildId === null) return;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const optionId = interaction.options.getString('option', true);
    const result = await this.container.services.verification.removeOption(optionId);
    if (!result.ok) {
      await interaction.editReply({ content: result.error.message });
      return;
    }
    await interaction.editReply({
      content: `Removed option \`${optionId}\`.`,
    });
  }
}
