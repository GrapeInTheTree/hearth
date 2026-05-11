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

    const result = await this.container.services.selfRoles.handleReactionRemove({
      messageId: reaction.message.id,
      emoji: reaction.emoji.identifier,
      userId: user.id,
      guildId: reaction.message.guildId,
    });
    if (!result.ok) {
      this.container.logger.warn(
        { err: result.error, panel: reaction.message.id, emoji: reaction.emoji.identifier },
        'self-roles reaction remove failed unexpectedly',
      );
    }
  }
}
