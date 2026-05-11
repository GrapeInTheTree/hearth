// Pure diff logic for syncBotReactions, extracted so it can be unit
// tested without standing up a discord.js Client mock. The djs gateway
// passes message.reactions.cache values (with a narrow structural
// type — see ReactionLike) and the desired emoji-key list; the diff
// returns what to add and which orphan bot reactions to strip.
//
// Why a separate file: the cache walk is the kind of code that bites
// twice — once when the off-by-one slips through review, and again
// when a future refactor accidentally treats user reactions as orphans
// because the `me` filter moved. The pure shape pins both invariants
// in tests that run in <1ms with zero Discord client setup.

/** Minimum shape we need off discord.js's ReactionEmoji. */
export interface ReactionEmojiLike {
  readonly id: string | null;
  readonly name: string | null;
}

/** Minimum shape we need off discord.js's MessageReaction. The generic
 *  parameter R lets the djs gateway pass the real reaction objects in
 *  so it can call `.users.remove` on the returned orphans without a
 *  second lookup. */
export interface ReactionLike<R> {
  /** True iff the bot itself has reacted with this emoji. discord.js
   *  populates `me` after the message is fetched. */
  readonly me: boolean;
  readonly emoji: ReactionEmojiLike;
  /** The original reaction object — opaque to the diff, returned in
   *  `orphansToRemove` so the caller can act on it directly. */
  readonly raw: R;
}

/** Convert a discord.js reaction emoji into the same key shape we store
 *  in DB (raw Unicode for built-in emoji, `<:name:id>` for custom).
 *  Mirrors the derivation in the reaction listeners so the same key
 *  round-trips through Discord → listener → DB → render → diff. */
export function reactionKey(emoji: ReactionEmojiLike): string {
  return emoji.id !== null ? `<:${emoji.name ?? ''}:${emoji.id}>` : (emoji.name ?? '');
}

export interface ReactionDiff<R> {
  /** Emoji keys the bot needs to react with — present in desired but
   *  absent from the bot's current reaction set. */
  readonly toAdd: readonly string[];
  /** Reactions the bot needs to remove its own copy from — its `me`
   *  flag is true but the emoji is no longer in the desired set
   *  (e.g. the operator removed that option). */
  readonly orphansToRemove: readonly R[];
}

/**
 * Two-set diff between the bot's current reactions on a message and
 * the desired emoji-key set. Pure — no Discord calls, no async, no
 * side effects.
 *
 *  - Reactions where `me === false` are ignored. User reactions are
 *    never touched by sync, even on emoji that no longer map to an
 *    option (the listener handles those — a click on an orphan
 *    emoji misses the (panelId, emoji) lookup → silent noop).
 *  - `toAdd` preserves the desired-list order so the caller (sequential
 *    `message.react` loop) ends up with the operator-configured
 *    left-to-right strip.
 *  - `orphansToRemove` returns the original reaction objects so the
 *    caller can `.users.remove(botId)` without a second cache search.
 */
export function computeReactionDiff<R>(
  reactions: readonly ReactionLike<R>[],
  desiredEmojiKeys: readonly string[],
): ReactionDiff<R> {
  const desired = new Set(desiredEmojiKeys);
  const botHas = new Set<string>();
  const orphansToRemove: R[] = [];

  for (const reaction of reactions) {
    if (!reaction.me) continue;
    const key = reactionKey(reaction.emoji);
    botHas.add(key);
    if (!desired.has(key)) {
      orphansToRemove.push(reaction.raw);
    }
  }

  const toAdd: string[] = [];
  for (const key of desiredEmojiKeys) {
    if (!botHas.has(key)) toAdd.push(key);
  }

  return { toAdd, orphansToRemove };
}
