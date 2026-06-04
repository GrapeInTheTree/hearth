import { createId } from '@paralleldrive/cuid2';
import { relations } from 'drizzle-orm';
import { boolean, index, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

import { xWatcherEvent } from './xWatcherEvent.js';

// An X (Twitter) account watcher — mirrors every new post from one X
// account into one Discord channel as a bare link. Original posts and
// quote posts are mirrored; retweets are always skipped (product spec);
// replies are skipped by default but operators can opt in per watcher.
//
// One row = one (sourceHandle → channelId) binding. A guild can run
// several watchers (different accounts, or the same account fanned out
// to multiple channels). The unique (guildId, sourceHandle, channelId)
// index stops an operator from creating the same binding twice.
//
// HOW IT STAYS SOURCE-AGNOSTIC: this table holds zero vendor-specific
// state. `sourceUserId` is the X numeric id (stable across handle
// renames) resolved lazily on first poll via the XFeedSource port, and
// `lastTweetId` is the X status id of the newest post we've processed —
// both are X's own identifiers, not a vendor's feed cursor. Whether the
// posts arrive via the official X API, RSS.app, or RSSHub, the dedupe
// cursor means nothing downstream changes when the source is swapped
// (X_FEED_SOURCE env + a different XFeedSource implementation).
//
// DEDUPE / BACKFILL: `lastTweetId` is the high-water mark. It is NULL
// until the first poll, which SEEDS it to the account's newest post id
// WITHOUT posting anything — otherwise enabling a watcher would dump the
// account's entire recent history into the channel. Every subsequent
// poll asks the source for posts strictly newer than `lastTweetId`,
// mirrors them oldest-first, then advances the cursor. Because the
// cursor is persisted and the bot runs single-instance (per community),
// a restart never re-posts: the next poll resumes from the stored id.
export const xWatcher = pgTable(
  'XWatcher',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    guildId: text('guildId').notNull(),
    // The X handle WITHOUT the leading '@' (e.g. 'KayenFinance'). Stored
    // as the operator typed it; the source layer lowercases for API
    // calls where needed. Display uses this verbatim.
    sourceHandle: text('sourceHandle').notNull(),
    // X's numeric user id. NULL until the first poll resolves it from the
    // handle (XFeedSource.resolveUser). Persisted so later polls skip the
    // resolution round-trip and survive handle renames (the id is stable;
    // the handle is not).
    sourceUserId: text('sourceUserId'),
    // Discord channel the bare links are posted into.
    channelId: text('channelId').notNull(),
    // Dedupe high-water mark — the X status id of the newest post already
    // processed. NULL = freshly created, not yet seeded (first poll seeds
    // it silently; see the table comment).
    lastTweetId: text('lastTweetId'),
    // Last time a poll completed (success OR a handled empty result), for
    // operator visibility / staleness alerting. NULL until the first poll.
    lastCheckedAt: timestamp('lastCheckedAt', { precision: 3, mode: 'date' }),
    // Operators pause a watcher without deleting it (keeps the cursor so
    // re-enabling doesn't backfill). The poller only considers enabled rows.
    enabled: boolean('enabled').notNull().default(true),
    // Quote posts are mirrored by default (product spec includes them).
    // Kept as a column so a future operator who wants links-only-no-quotes
    // can toggle without a migration.
    includeQuotes: boolean('includeQuotes').notNull().default(true),
    // Replies are NOT mirrored by default — a reply isn't really a "post"
    // in the announcement sense, and a chatty account would flood the
    // channel. Operators opt in per watcher. Retweets have no toggle:
    // the spec excludes them unconditionally.
    includeReplies: boolean('includeReplies').notNull().default(false),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // Dashboard list view: every watcher for a guild.
    index('XWatcher_guildId_idx').on(t.guildId),
    // One binding per (account → channel) per guild. Re-creating the same
    // binding is an operator error, not a second feed.
    uniqueIndex('XWatcher_guildId_sourceHandle_channelId_key').on(
      t.guildId,
      t.sourceHandle,
      t.channelId,
    ),
  ],
);

export const xWatcherRelations = relations(xWatcher, ({ many }) => ({
  events: many(xWatcherEvent),
}));
