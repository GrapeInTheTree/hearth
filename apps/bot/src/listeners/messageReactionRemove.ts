import { Events, Listener } from '@sapphire/framework';
import type { MessageReaction, PartialMessageReaction, PartialUser, User } from 'discord.js';

/**
 * Mirror of MessageReactionAddListener for the reaction-remove case.
 * Removing a reaction revokes the role — the service does the
 * (messageId, emoji) lookup and a removeRoleFromMember call. Same
 * filters and partial-handling as the add path.
 */
export class MessageReactionRemoveListener extends Listener<typeof Events.MessageReactionRemove> {
  public constructor(context: Listener.LoaderContext, options: Listener.Options) {
    super(context, { ...options, event: Events.MessageReactionRemove });
  }

  public override async run(
    reaction: MessageReaction | PartialMessageReaction,
    user: User | PartialUser,
  ): Promise<void> {
    if (user.bot) return;
    if (reaction.partial) {
      try {
        await reaction.fetch();
      } catch {
        return;
      }
    }
    if (reaction.message.partial) {
      try {
        await reaction.message.fetch();
      } catch {
        return;
      }
    }
    const botId = this.container.client.user?.id;
    if (botId === undefined || reaction.message.author?.id !== botId) return;
    if (reaction.message.guildId === null) return;

    // discord.js's reaction.emoji.identifier is URL-encoded for Unicode
    // (REST API path form). Our DB stores the raw codepoint, so we have
    // to denormalise here. Same shape as messageReactionAdd.
    const emojiKey =
      reaction.emoji.id !== null
        ? `<:${reaction.emoji.name ?? ''}:${reaction.emoji.id}>`
        : (reaction.emoji.name ?? '');

    const result = await this.container.services.selfRoles.handleReactionRemove({
      messageId: reaction.message.id,
      emoji: emojiKey,
      userId: user.id,
      guildId: reaction.message.guildId,
    });
    if (!result.ok) {
      this.container.logger.warn(
        { err: result.error, panel: reaction.message.id, emoji: emojiKey },
        'self-roles reaction remove failed unexpectedly',
      );
    }
  }
}
