import { createId } from '@paralleldrive/cuid2';
import { relations } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

import { xWatcher } from './xWatcher.js';

// Audit + dedupe ledger: exactly one row per post the poller observes.
// `status` records what happened to it:
//   'posted'          — mirrored to Discord; `postedMessageId` is set
//   'skipped_retweet' — a retweet; spec excludes these unconditionally
//   'skipped_reply'   — a reply and the watcher has includeReplies=false
//   'send_failed'     — postable, but the Discord send threw (perms /
//                       channel gone / rate limit). The cursor still
//                       advances so we don't wedge on one bad post; the
//                       failure is recorded here + logged for the operator.
//
// `kind` is the source-layer classification of the post itself
// (original / quote / retweet / reply) as reported by XFeedSource — the
// single source of truth the skip logic keys off. Stored alongside
// `status` so the log answers both "what was it" and "what did we do".
//
// Both are plain text (not pgEnum) so a new status or kind can be added
// without an ALTER TYPE migration — same convention as the other
// domains' action/outcome columns.
//
// DEDUPE: UNIQUE (watcherId, tweetId) makes the ledger idempotent. The
// primary dedupe is the watcher's `lastTweetId` cursor (the source only
// returns newer posts), but this constraint is defense-in-depth: if a
// poll ever overlaps or a retry re-observes a post, the second insert
// raises a unique violation that the poller swallows — the post is never
// mirrored twice.
//
// RETENTION: watcherId FK CASCADE. A watcher is the retention boundary —
// deleting it is an intentional "stop and forget this feed", so its
// event history goes with it. (Contrast role-picker options, which use
// SET NULL because the panel, not the option, is the boundary.)
export const xWatcherEvent = pgTable(
  'XWatcherEvent',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    watcherId: text('watcherId')
      .notNull()
      .references(() => xWatcher.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    // X status id of the post. Combined with watcherId this is the
    // idempotency key (see UNIQUE below).
    tweetId: text('tweetId').notNull(),
    // The canonical x.com link as built by the source — the exact string
    // we post (or would have posted) to Discord.
    tweetUrl: text('tweetUrl').notNull(),
    // Source-layer post classification: 'original' | 'quote' | 'retweet'
    // | 'reply'. See XFeedSource.TweetItem in @hearth/x-watcher-core.
    kind: text('kind').notNull(),
    // Outcome — see the XWatcherEventStatus union in @hearth/database.
    status: text('status').notNull(),
    // Discord message id when status='posted'; NULL otherwise. Lets the
    // dashboard deep-link to the posted message.
    postedMessageId: text('postedMessageId'),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    // Dashboard "recent activity for this watcher", newest first.
    index('XWatcherEvent_watcherId_createdAt_idx').on(t.watcherId, t.createdAt),
    // Idempotency: one ledger row per observed post per watcher.
    uniqueIndex('XWatcherEvent_watcherId_tweetId_key').on(t.watcherId, t.tweetId),
  ],
);

export const xWatcherEventRelations = relations(xWatcherEvent, ({ one }) => ({
  watcher: one(xWatcher, {
    fields: [xWatcherEvent.watcherId],
    references: [xWatcher.id],
  }),
}));
