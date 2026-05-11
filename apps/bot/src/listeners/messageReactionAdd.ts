import { Events, Listener } from '@sapphire/framework';
import type { MessageReaction, PartialMessageReaction, PartialUser, User } from 'discord.js';

/**
 * Routes Discord reaction-add events into the self-roles service.
 *
 * Filters at the listener entry to skip the (vast) majority of reactions
 * that have nothing to do with self-roles:
 *   1. Reactions from the bot itself (the bot pre-adds them on render).
 *   2. Reactions on messages the bot didn't author.
 * Only after both filters pass does the service hit the DB.
 *
 * Partial events: when the message/reaction isn't in the cache (e.g. bot
 * restart) we materialise it via fetch() before reading message.author.
 * The bot's index.ts enables Partials.Message / Channel / Reaction so the
 * gateway delivers these events at all.
 *
 * Reaction events have no customId, so identity is `(messageId, emoji)` —
 * the unique index on SelfRolesOption(panelId, emoji) makes the lookup
 * an O(log n) query.
 */
export class MessageReactionAddListener extends Listener<typeof Events.MessageReactionAdd> {
  public constructor(context: Listener.LoaderContext, options: Listener.Options) {
    super(context, { ...options, event: Events.MessageReactionAdd });
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

    const result = await this.container.services.selfRoles.handleReactionAdd({
      messageId: reaction.message.id,
      emoji: reaction.emoji.identifier,
      userId: user.id,
      guildId: reaction.message.guildId,
    });
    if (!result.ok) {
      this.container.logger.warn(
        { err: result.error, panel: reaction.message.id, emoji: reaction.emoji.identifier },
        'self-roles reaction add failed unexpectedly',
      );
    }
  }
}
