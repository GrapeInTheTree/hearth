import { ReactionRolesAction } from '@hearth/database';
import { Events, Listener } from '@sapphire/framework';
import type { MessageReaction, PartialMessageReaction, PartialUser, User } from 'discord.js';

/**
 * Routes Discord reaction-add events into the reaction-roles service.
 *
 * Filters at the listener entry to skip the (vast) majority of reactions
 * that have nothing to do with reaction-roles:
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
 * the unique index on ReactionRolesOption(panelId, emoji) makes the lookup
 * an O(log n) query. The emoji key has to match the shape stored in DB:
 * raw Unicode codepoint for built-in emoji, `<:name:id>` for custom ones.
 * discord.js's `reaction.emoji.identifier` is URL-encoded for the REST
 * API path (`%F0%9F%87%B0%F0%9F%87%B7`) and never matches our rows —
 * see emojiKey derivation below.
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

    const emojiKey =
      reaction.emoji.id !== null
        ? `<:${reaction.emoji.name ?? ''}:${reaction.emoji.id}>`
        : (reaction.emoji.name ?? '');

    const result = await this.container.services.reactionRoles.handleReactionAdd({
      messageId: reaction.message.id,
      emoji: emojiKey,
      userId: user.id,
      guildId: reaction.message.guildId,
    });
    if (!result.ok) {
      this.container.logger.warn(
        { err: result.error, panel: reaction.message.id, emoji: emojiKey },
        'reaction-roles reaction add failed unexpectedly',
      );
      return;
    }
    // INFO-level breadcrumb on every meaningful outcome — operators can
    // grep the bot log when a user complains "I clicked but nothing
    // happened." `noop` is the most useful line here: it usually means
    // Manage Roles missing or a role-hierarchy violation, which is
    // exactly when the operator needs visibility. DB audit row carries
    // the same info but the log lands in the deploy console first.
    this.container.logger.info(
      {
        action: result.value.action,
        userId: user.id,
        emoji: emojiKey,
        messageId: reaction.message.id,
        guildId: reaction.message.guildId,
        roleId: result.value.roleId,
      },
      result.value.action === ReactionRolesAction.granted
        ? 'reaction-roles role granted'
        : 'reaction-roles add noop (role op rejected or emoji not bound)',
    );
  }
}
