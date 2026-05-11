import { describe, expect, it } from 'vitest';

import {
  computeReactionDiff,
  reactionKey,
  type ReactionLike,
} from '../../src/services/ports/reactionDiff.js';

// Wrapper that lets each test build a reaction list inline. The `raw`
// payload is arbitrary — we use a string label so we can assert
// orphansToRemove returns the *exact* reaction objects without making
// the test about discord.js types.
function reaction(
  raw: string,
  emoji: { id: string | null; name: string | null },
  me: boolean,
): ReactionLike<string> {
  return { me, emoji, raw };
}

describe('reactionKey', () => {
  it('returns the raw Unicode name for built-in emoji (id is null)', () => {
    expect(reactionKey({ id: null, name: '🇰🇷' })).toBe('🇰🇷');
  });

  it('reassembles the <:name:id> form for custom emoji', () => {
    expect(reactionKey({ id: '1234567890123456789', name: 'partyparrot' })).toBe(
      '<:partyparrot:1234567890123456789>',
    );
  });

  it('falls back to empty name segment when discord.js drops the name', () => {
    // discord.js occasionally fires partial reaction events where
    // emoji.name is null even on custom emoji. We don't crash — the
    // key just loses the human-readable prefix, which still
    // round-trips with whatever DB row was written from the same
    // source (the option-form validation rejects empty names, so the
    // miss-match is expected and falls through to a silent noop).
    expect(reactionKey({ id: '1234567890123456789', name: null })).toBe('<::1234567890123456789>');
  });

  it('returns empty string when both id and name are null', () => {
    expect(reactionKey({ id: null, name: null })).toBe('');
  });
});

describe('computeReactionDiff', () => {
  it('returns empty diff when the bot already holds exactly the desired set', () => {
    const reactions = [
      reaction('r-us', { id: null, name: '🇺🇸' }, true),
      reaction('r-kr', { id: null, name: '🇰🇷' }, true),
    ];
    const result = computeReactionDiff(reactions, ['🇺🇸', '🇰🇷']);
    expect(result.toAdd).toEqual([]);
    expect(result.orphansToRemove).toEqual([]);
  });

  it('adds missing emoji in desired-list order so the strip respects position', () => {
    const reactions = [reaction('r-us', { id: null, name: '🇺🇸' }, true)];
    const result = computeReactionDiff(reactions, ['🇺🇸', '🇰🇷', '🇯🇵']);
    expect(result.toAdd).toEqual(['🇰🇷', '🇯🇵']);
    expect(result.orphansToRemove).toEqual([]);
  });

  it('removes orphan bot reactions whose emoji is no longer in the desired set', () => {
    const reactions = [
      reaction('r-us', { id: null, name: '🇺🇸' }, true),
      reaction('r-kr-orphan', { id: null, name: '🇰🇷' }, true),
    ];
    const result = computeReactionDiff(reactions, ['🇺🇸']);
    expect(result.toAdd).toEqual([]);
    expect(result.orphansToRemove).toEqual(['r-kr-orphan']);
  });

  it('never touches user reactions, even on emoji not in the desired set', () => {
    // A user reacted with 🇯🇵, but no option binds 🇯🇵. The bot's `me`
    // flag is false on that reaction, so sync ignores it. The
    // listener will see the click and noop on lookup miss.
    const reactions = [
      reaction('r-us-bot', { id: null, name: '🇺🇸' }, true),
      reaction('r-jp-user', { id: null, name: '🇯🇵' }, false),
    ];
    const result = computeReactionDiff(reactions, ['🇺🇸']);
    expect(result.toAdd).toEqual([]);
    expect(result.orphansToRemove).toEqual([]);
  });

  it('keeps shared user+bot reactions (me=true) when emoji is still desired', () => {
    // Common case: a user clicked 🇺🇸 too — the bot's `me` flag stays
    // true because the bot still has its own copy alongside the user's.
    // We do NOT remove this reaction. Sync is idempotent.
    const reactions = [reaction('r-us-shared', { id: null, name: '🇺🇸' }, true)];
    const result = computeReactionDiff(reactions, ['🇺🇸']);
    expect(result.toAdd).toEqual([]);
    expect(result.orphansToRemove).toEqual([]);
  });

  it('handles mixed add + remove in one diff (option-swap scenario)', () => {
    // Operator deletes the 🇰🇷 option and adds 🇯🇵 in the same edit.
    // Sync should both strip 🇰🇷 and add 🇯🇵 — the existing 🇺🇸 is
    // unchanged.
    const reactions = [
      reaction('r-us', { id: null, name: '🇺🇸' }, true),
      reaction('r-kr-orphan', { id: null, name: '🇰🇷' }, true),
    ];
    const result = computeReactionDiff(reactions, ['🇺🇸', '🇯🇵']);
    expect(result.toAdd).toEqual(['🇯🇵']);
    expect(result.orphansToRemove).toEqual(['r-kr-orphan']);
  });

  it('treats custom emoji identity by id, not name', () => {
    // Two custom emoji with the same name but different ids — they
    // come from different guilds and are not interchangeable. The
    // <:name:id> key shape captures the id so neither is mistaken
    // for the other.
    const reactions = [reaction('r-cat-A', { id: '111111111111111111', name: 'cat' }, true)];
    const result = computeReactionDiff(reactions, ['<:cat:222222222222222222>']);
    expect(result.toAdd).toEqual(['<:cat:222222222222222222>']);
    expect(result.orphansToRemove).toEqual(['r-cat-A']);
  });

  it('returns empty diff for an empty desired set when the bot has no reactions', () => {
    const result = computeReactionDiff<string>([], []);
    expect(result.toAdd).toEqual([]);
    expect(result.orphansToRemove).toEqual([]);
  });

  it('removes ALL bot reactions when desired set is empty (last option deleted)', () => {
    const reactions = [
      reaction('r-us', { id: null, name: '🇺🇸' }, true),
      reaction('r-kr', { id: null, name: '🇰🇷' }, true),
    ];
    const result = computeReactionDiff(reactions, []);
    expect(result.toAdd).toEqual([]);
    expect(result.orphansToRemove).toEqual(['r-us', 'r-kr']);
  });

  it('ignores user reactions when computing what to add', () => {
    // Bot has no reactions yet (fresh send race), but a user already
    // reacted with 🇺🇸 (unlikely but defensive — sync must add 🇺🇸
    // for the bot regardless of pre-existing user reactions).
    const reactions = [reaction('r-us-user', { id: null, name: '🇺🇸' }, false)];
    const result = computeReactionDiff(reactions, ['🇺🇸']);
    expect(result.toAdd).toEqual(['🇺🇸']);
    expect(result.orphansToRemove).toEqual([]);
  });

  it('preserves desired order even when the bot has reactions in a different order', () => {
    const reactions = [
      reaction('r-jp', { id: null, name: '🇯🇵' }, true),
      reaction('r-us', { id: null, name: '🇺🇸' }, true),
    ];
    // Desired is [US, JP, KR] — KR is missing, US/JP exist but in
    // reverse order. The diff only reports what's missing.
    const result = computeReactionDiff(reactions, ['🇺🇸', '🇯🇵', '🇰🇷']);
    expect(result.toAdd).toEqual(['🇰🇷']);
    expect(result.orphansToRemove).toEqual([]);
  });
});
