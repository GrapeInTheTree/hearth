import { DiscordApiError } from '@hearth/shared';
import type {
  CreateTicketChannelInput,
  DiscordGateway,
  ModlogEmbed,
  PanelMessagePayload,
  SendWelcomeMessageInput,
  WelcomeMessagePayload,
} from '@hearth/tickets-core';
import {
  type APIEmbed,
  type Client,
  ChannelType,
  type GuildBasedChannel,
  type GuildChannel,
  OverwriteType,
  PermissionFlagsBits,
  type TextChannel,
} from 'discord.js';

// Production implementation of DiscordGateway. Wraps a SapphireClient and
// converts every discord.js exception into DiscordApiError so service code
// has a single error class to branch on. Never expose discord.js types here.

export class DjsDiscordGateway implements DiscordGateway {
  public constructor(private readonly client: Client) {}

  public async createTicketChannel(
    input: CreateTicketChannelInput,
  ): Promise<{ channelId: string }> {
    return await this.wrap('createTicketChannel', async () => {
      const guild = await this.client.guilds.fetch(input.guildId);
      const channel = await guild.channels.create({
        name: input.name,
        type: ChannelType.GuildText,
        parent: input.parentId,
        topic: input.topic,
        permissionOverwrites: [
          {
            id: guild.roles.everyone.id,
            deny: PermissionFlagsBits.ViewChannel,
            type: OverwriteType.Role,
          },
          {
            id: input.openerId,
            allow:
              PermissionFlagsBits.ViewChannel |
              PermissionFlagsBits.SendMessages |
              PermissionFlagsBits.ReadMessageHistory |
              PermissionFlagsBits.AttachFiles,
            type: OverwriteType.Member,
          },
          ...input.supportRoleIds.map((id) => ({
            id,
            allow:
              PermissionFlagsBits.ViewChannel |
              PermissionFlagsBits.SendMessages |
              PermissionFlagsBits.ReadMessageHistory |
              PermissionFlagsBits.ManageMessages |
              PermissionFlagsBits.AttachFiles,
            type: OverwriteType.Role,
          })),
        ],
      });
      return { channelId: channel.id };
    });
  }

  public async sendWelcomeMessage(input: SendWelcomeMessageInput): Promise<{ messageId: string }> {
    return await this.wrap('sendWelcomeMessage', async () => {
      const channel = await this.fetchTextChannel(input.channelId);
      const mentionLine =
        input.pingRoleIds.length > 0
          ? input.pingRoleIds.map((r) => `<@&${r}>`).join(' ')
          : undefined;
      const message = await channel.send({
        ...(mentionLine !== undefined ? { content: mentionLine } : {}),
        embeds: input.payload.embeds,
        components: input.payload.components as never,
        allowedMentions: { roles: [...input.pingRoleIds] },
      });
      if (input.pin) {
        await message.pin().catch(() => undefined);
      }
      return { messageId: message.id };
    });
  }

  public async editWelcomeMessage(
    channelId: string,
    messageId: string,
    payload: WelcomeMessagePayload,
  ): Promise<void> {
    await this.wrap('editWelcomeMessage', async () => {
      const channel = await this.fetchTextChannel(channelId);
      const message = await channel.messages.fetch(messageId);
      await message.edit({
        embeds: payload.embeds,
        components: payload.components as never,
      });
    });
  }

  public async postSystemMessage(channelId: string, content: string): Promise<void> {
    await this.wrap('postSystemMessage', async () => {
      const channel = await this.fetchTextChannel(channelId);
      await channel.send({ content, allowedMentions: { parse: [] } });
    });
  }

  public async moveChannelToCategory(channelId: string, categoryId: string): Promise<void> {
    await this.wrap('moveChannelToCategory', async () => {
      const channel = await this.fetchGuildChannel(channelId);
      await channel.setParent(categoryId, { lockPermissions: false });
    });
  }

  public async setOpenerSendMessages(
    channelId: string,
    openerId: string,
    allow: boolean,
  ): Promise<void> {
    await this.wrap('setOpenerSendMessages', async () => {
      const channel = await this.fetchGuildChannel(channelId);
      await channel.permissionOverwrites.edit(openerId, {
        SendMessages: allow,
        AddReactions: allow,
      });
    });
  }

  public async countCategoryChildren(categoryId: string): Promise<number> {
    return await this.wrap('countCategoryChildren', async () => {
      const category = await this.client.channels.fetch(categoryId);
      if (category === null || category.type !== ChannelType.GuildCategory) {
        throw new DiscordApiError(`Channel ${categoryId} is not a category`);
      }
      return category.children.cache.size;
    });
  }

  public async deleteChannel(channelId: string, reason: string): Promise<void> {
    await this.wrap('deleteChannel', async () => {
      const channel = await this.fetchGuildChannel(channelId);
      await channel.delete(reason);
    });
  }

  public async postModlogSummary(logChannelId: string, embed: ModlogEmbed): Promise<void> {
    await this.wrap('postModlogSummary', async () => {
      const channel = await this.fetchTextChannel(logChannelId);
      await channel.send({
        embeds: [
          {
            title: embed.title,
            ...(embed.color !== undefined ? { color: embed.color } : {}),
            fields: [...embed.fields],
            ...(embed.timestamp !== undefined ? { timestamp: embed.timestamp } : {}),
          },
        ],
      });
    });
  }

  public async sendPanelMessage(
    channelId: string,
    payload: PanelMessagePayload,
  ): Promise<{ messageId: string }> {
    return await this.wrap('sendPanelMessage', async () => {
      const channel = await this.fetchTextChannel(channelId);
      const message = await channel.send({
        ...(payload.content !== undefined ? { content: payload.content } : {}),
        embeds: payload.embeds as APIEmbed[],
        components: payload.components as never,
      });
      return { messageId: message.id };
    });
  }

  public async editPanelMessage(
    channelId: string,
    messageId: string,
    payload: PanelMessagePayload,
  ): Promise<void> {
    await this.wrap('editPanelMessage', async () => {
      const channel = await this.fetchTextChannel(channelId);
      const message = await channel.messages.fetch(messageId);
      await message.edit({
        ...(payload.content !== undefined ? { content: payload.content } : {}),
        embeds: payload.embeds as APIEmbed[],
        components: payload.components as never,
      });
    });
  }

  public async resolveMemberDisplay(guildId: string, userId: string): Promise<string> {
    return await this.wrap('resolveMemberDisplay', async () => {
      const guild = await this.client.guilds.fetch(guildId);
      const member = await guild.members.fetch(userId).catch(() => null);
      return member?.displayName ?? userId;
    });
  }

  private async fetchGuildChannel(channelId: string): Promise<GuildChannel> {
    const channel = (await this.client.channels.fetch(channelId)) as GuildBasedChannel | null;
    if (channel === null || !('guild' in channel)) {
      throw new DiscordApiError(`Channel ${channelId} not found or not a guild channel`);
    }
    return channel as GuildChannel;
  }

  private async fetchTextChannel(channelId: string): Promise<TextChannel> {
    const channel = await this.client.channels.fetch(channelId);
    if (channel === null || channel.type !== ChannelType.GuildText) {
      throw new DiscordApiError(`Channel ${channelId} is not a text channel`);
    }
    return channel;
  }

  private async wrap<T>(op: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof DiscordApiError) throw err;
      const status =
        typeof err === 'object' && err !== null && 'status' in err
          ? (err as { status?: unknown }).status
          : undefined;
      throw new DiscordApiError(
        `Discord API call failed: ${op}`,
        typeof status === 'number' ? status : undefined,
        err,
      );
    }
  }
}
