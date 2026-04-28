import { ConflictError, NotFoundError } from '@hearth/shared';
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
            .setDescription('Create or update a ticket panel in a channel.')
            .addChannelOption((opt) =>
              opt
                .setName('channel')
                .setDescription('Channel where the panel message will live.')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(true),
            )
            .addStringOption((opt) =>
              opt
                .setName('title')
                .setDescription('Embed title (defaults to "Contact Team").')
                .setMaxLength(256)
                .setRequired(false),
            )
            .addStringOption((opt) =>
              opt
                .setName('description')
                .setDescription(
                  'Embed body text. Multi-line OK; channel mentions like <#id> render.',
                )
                .setMaxLength(4000)
                .setRequired(false),
            ),
        )
        .addSubcommandGroup((group) =>
          group
            .setName('ticket-type')
            .setDescription('Manage individual buttons (ticket types) on a panel.')
            .addSubcommand((sub) =>
              sub
                .setName('add')
                .setDescription('Add a new ticket type (button) to a panel.')
                .addStringOption((opt) =>
                  opt
                    .setName('panel')
                    .setDescription('Panel ID (see /panel list).')
                    .setRequired(true),
                )
                .addStringOption((opt) =>
                  opt
                    .setName('name')
                    .setDescription('Stable lookup key, e.g. "question". Must be unique per panel.')
                    .setMaxLength(64)
                    .setRequired(true),
                )
                .addStringOption((opt) =>
                  opt
                    .setName('label')
                    .setDescription('Visible button text, e.g. "Question (1:1)".')
                    .setMaxLength(80)
                    .setRequired(true),
                )
                .addChannelOption((opt) =>
                  opt
                    .setName('active-category')
                    .setDescription('Category where new ticket channels of this type are created.')
                    .addChannelTypes(ChannelType.GuildCategory)
                    .setRequired(true),
                )
                .addRoleOption((opt) =>
                  opt
                    .setName('support-role')
                    .setDescription('Role allowed to claim/close/reopen.')
                    .setRequired(true),
                )
                .addRoleOption((opt) =>
                  opt
                    .setName('support-role-2')
                    .setDescription('Additional support role.')
                    .setRequired(false),
                )
                .addRoleOption((opt) =>
                  opt
                    .setName('support-role-3')
                    .setDescription('Additional support role.')
                    .setRequired(false),
                )
                .addStringOption((opt) =>
                  opt
                    .setName('emoji')
                    .setDescription(
                      'Button emoji (Unicode like ❓ or custom <:name:id>). Optional.',
                    )
                    .setMaxLength(64)
                    .setRequired(false),
                )
                .addStringOption((opt) =>
                  opt
                    .setName('button-style')
                    .setDescription('Button color (default: success).')
                    .addChoices(...BUTTON_STYLE_CHOICES)
                    .setRequired(false),
                )
                .addRoleOption((opt) =>
                  opt
                    .setName('ping-role')
                    .setDescription('Role pinged when a ticket of this type is opened.')
                    .setRequired(false),
                )
                .addRoleOption((opt) =>
                  opt
                    .setName('ping-role-2')
                    .setDescription('Additional ping role.')
                    .setRequired(false),
                )
                .addIntegerOption((opt) =>
                  opt
                    .setName('per-user-limit')
                    .setDescription(
                      'Max simultaneous open tickets per user for this type (default 1).',
                    )
                    .setMinValue(1)
                    .setMaxValue(20)
                    .setRequired(false),
                )
                .addStringOption((opt) =>
                  opt
                    .setName('welcome-message')
                    .setDescription(
                      'Override welcome message for tickets of this type. Multi-line OK.',
                    )
                    .setMaxLength(4000)
                    .setRequired(false),
                ),
            )
            .addSubcommand((sub) =>
              sub
                .setName('edit')
                .setDescription('Update fields of an existing ticket type.')
                .addStringOption((opt) =>
                  opt.setName('panel').setDescription('Panel ID.').setRequired(true),
                )
                .addStringOption((opt) =>
                  opt
                    .setName('name')
                    .setDescription('Existing ticket type name (lookup key).')
                    .setRequired(true),
                )
                .addStringOption((opt) =>
                  opt.setName('label').setDescription('New button label.').setRequired(false),
                )
                .addStringOption((opt) =>
                  opt.setName('emoji').setDescription('New button emoji.').setRequired(false),
                )
                .addStringOption((opt) =>
                  opt
                    .setName('button-style')
                    .setDescription('New button color.')
                    .addChoices(...BUTTON_STYLE_CHOICES)
                    .setRequired(false),
                )
                .addChannelOption((opt) =>
                  opt
                    .setName('active-category')
                    .setDescription('New active category.')
                    .addChannelTypes(ChannelType.GuildCategory)
                    .setRequired(false),
                )
                .addRoleOption((opt) =>
                  opt
                    .setName('support-role')
                    .setDescription('New primary support role (overrides existing list).')
                    .setRequired(false),
                )
                .addRoleOption((opt) =>
                  opt
                    .setName('support-role-2')
                    .setDescription('Additional support role.')
                    .setRequired(false),
                )
                .addRoleOption((opt) =>
                  opt
                    .setName('support-role-3')
                    .setDescription('Additional support role.')
                    .setRequired(false),
                )
                .addRoleOption((opt) =>
                  opt
                    .setName('ping-role')
                    .setDescription('New primary ping role (overrides existing list).')
                    .setRequired(false),
                )
                .addRoleOption((opt) =>
                  opt
                    .setName('ping-role-2')
                    .setDescription('Additional ping role.')
                    .setRequired(false),
                )
                .addIntegerOption((opt) =>
                  opt
                    .setName('per-user-limit')
                    .setDescription('New per-user limit.')
                    .setMinValue(1)
                    .setMaxValue(20)
                    .setRequired(false),
                )
                .addStringOption((opt) =>
                  opt
                    .setName('welcome-message')
                    .setDescription('New welcome message override.')
                    .setMaxLength(4000)
                    .setRequired(false),
                ),
            )
            .addSubcommand((sub) =>
              sub
                .setName('remove')
                .setDescription(
                  'Remove a ticket type from a panel (fails if any tickets reference it).',
                )
                .addStringOption((opt) =>
                  opt.setName('panel').setDescription('Panel ID.').setRequired(true),
                )
                .addStringOption((opt) =>
                  opt
                    .setName('name')
                    .setDescription('Ticket type name to remove.')
                    .setRequired(true),
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
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand(true);

    if (group === 'ticket-type') {
      switch (sub) {
        case 'add':
          await this.runTicketTypeAdd(interaction);
          return;
        case 'edit':
          await this.runTicketTypeEdit(interaction);
          return;
        case 'remove':
          await this.runTicketTypeRemove(interaction);
          return;
      }
    }

    if (sub === 'create') {
      await this.runCreate(interaction);
      return;
    }
    if (sub === 'list') {
      await this.runList(interaction);
      return;
    }
  }

  // ─────────────────────────── /panel create ───────────────────────────

  private async runCreate(interaction: Command.ChatInputCommandInteraction): Promise<void> {
    if (interaction.guildId === null) return;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const channel = interaction.options.getChannel('channel', true);
    const title = interaction.options.getString('title', false) ?? undefined;
    const description = interaction.options.getString('description', false) ?? undefined;

    const result = await this.container.services.panel.upsertPanel({
      guildId: interaction.guildId,
      channelId: channel.id,
      ...(title !== undefined ? { embedTitle: title } : {}),
      ...(description !== undefined ? { embedDescription: description } : {}),
    });
    if (!result.ok) {
      await interaction.editReply({ content: result.error.message });
      return;
    }
    const verb = result.value.created ? 'Created' : 'Updated';
    await interaction.editReply({
      content: `${verb} panel in <#${channel.id}>. (Panel ID: \`${result.value.panel.id}\`)\nUse \`/panel ticket-type add panel:${result.value.panel.id}\` to add buttons.`,
    });
  }

  // ───────────────────── /panel ticket-type add/edit/remove ─────────────────────

  private async runTicketTypeAdd(interaction: Command.ChatInputCommandInteraction): Promise<void> {
    if (interaction.guildId === null) return;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const panelId = interaction.options.getString('panel', true);
    const name = interaction.options.getString('name', true);
    const label = interaction.options.getString('label', true);
    const activeCategory = interaction.options.getChannel('active-category', true);
    const emoji = interaction.options.getString('emoji', false) ?? '';
    const buttonStyle = (interaction.options.getString('button-style', false) ??
      'success') as ButtonStyleChoice;
    const perUserLimit = interaction.options.getInteger('per-user-limit', false) ?? 1;
    const welcomeMessage = interaction.options.getString('welcome-message', false) ?? undefined;

    const supportRoleIds = collectRoleIds(interaction, [
      'support-role',
      'support-role-2',
      'support-role-3',
    ]);
    const pingRoleIds = collectRoleIds(interaction, ['ping-role', 'ping-role-2']);

    const result = await this.container.services.panel.addTicketType({
      panelId,
      name,
      label,
      emoji,
      buttonStyle,
      activeCategoryId: activeCategory.id,
      supportRoleIds,
      pingRoleIds,
      perUserLimit,
      ...(welcomeMessage !== undefined ? { welcomeMessage } : {}),
    });
    if (!result.ok) {
      await interaction.editReply({ content: result.error.message });
      return;
    }
    await interaction.editReply({
      content: `Added ticket type **${name}** to panel \`${panelId}\`. Button now visible.`,
    });
  }

  private async runTicketTypeEdit(interaction: Command.ChatInputCommandInteraction): Promise<void> {
    if (interaction.guildId === null) return;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const panelId = interaction.options.getString('panel', true);
    const name = interaction.options.getString('name', true);
    const label = interaction.options.getString('label', false);
    const emoji = interaction.options.getString('emoji', false);
    const buttonStyle = interaction.options.getString(
      'button-style',
      false,
    ) as ButtonStyleChoice | null;
    const activeCategory = interaction.options.getChannel('active-category', false);
    const perUserLimit = interaction.options.getInteger('per-user-limit', false);
    const welcomeMessage = interaction.options.getString('welcome-message', false);

    // Each role-* slot is independently optional. The operator having picked
    // at least one role for a slot family means "replace this family";
    // omitting the family entirely means "leave the existing list as-is".
    const supportRoleIds = hasAnyRolePicked(interaction, [
      'support-role',
      'support-role-2',
      'support-role-3',
    ])
      ? collectRoleIds(interaction, ['support-role', 'support-role-2', 'support-role-3'])
      : undefined;
    const pingRoleIds = hasAnyRolePicked(interaction, ['ping-role', 'ping-role-2'])
      ? collectRoleIds(interaction, ['ping-role', 'ping-role-2'])
      : undefined;

    const result = await this.container.services.panel.editTicketType({
      panelId,
      name,
      ...(label !== null ? { label } : {}),
      ...(emoji !== null ? { emoji } : {}),
      ...(buttonStyle !== null ? { buttonStyle } : {}),
      ...(activeCategory !== null ? { activeCategoryId: activeCategory.id } : {}),
      ...(supportRoleIds !== undefined ? { supportRoleIds } : {}),
      ...(pingRoleIds !== undefined ? { pingRoleIds } : {}),
      ...(perUserLimit !== null ? { perUserLimit } : {}),
      ...(welcomeMessage !== null ? { welcomeMessage } : {}),
    });
    if (!result.ok) {
      await interaction.editReply({ content: result.error.message });
      return;
    }
    await interaction.editReply({
      content: `Updated ticket type **${name}** on panel \`${panelId}\`.`,
    });
  }

  private async runTicketTypeRemove(
    interaction: Command.ChatInputCommandInteraction,
  ): Promise<void> {
    if (interaction.guildId === null) return;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const panelId = interaction.options.getString('panel', true);
    const name = interaction.options.getString('name', true);

    const result = await this.container.services.panel.removeTicketType(panelId, name);
    if (!result.ok) {
      const message =
        result.error instanceof ConflictError || result.error instanceof NotFoundError
          ? result.error.message
          : i18n.common.errors.generic;
      await interaction.editReply({ content: message });
      return;
    }
    await interaction.editReply({
      content: `Removed ticket type **${name}** from panel \`${panelId}\`.`,
    });
  }

  // ─────────────────────────── /panel list ───────────────────────────

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

/**
 * Collect role IDs from N optional addRoleOption slots, preserving picker
 * order and de-duplicating (operator might pick the same role twice across
 * slots). Empty when the operator left every slot unset.
 */
function collectRoleIds(
  interaction: Command.ChatInputCommandInteraction,
  optionNames: readonly string[],
): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const name of optionNames) {
    const role = interaction.options.getRole(name, false);
    if (role !== null && !seen.has(role.id)) {
      seen.add(role.id);
      ordered.push(role.id);
    }
  }
  return ordered;
}

function hasAnyRolePicked(
  interaction: Command.ChatInputCommandInteraction,
  optionNames: readonly string[],
): boolean {
  return optionNames.some((name) => interaction.options.getRole(name, false) !== null);
}
