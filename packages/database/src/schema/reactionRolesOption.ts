import { createId } from '@paralleldrive/cuid2';
import { relations } from 'drizzle-orm';
import { index, integer, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

import { reactionRolesPanel } from './reactionRolesPanel.js';

// One emoji-to-role binding on a reaction-roles panel. Adding the reaction
// grants `roleId` to the user; removing the reaction revokes it. Per-option
// `roleId` (rather than panel-level) is the defining difference from
// VerificationOption — a panel with four flags surfaces four different
// language roles, and a user can hold any subset of them.
//
// `emoji` is unique within a panel because the reaction → option lookup
// uses (panelId, emoji) as the identity key. Position orders the reactions
// left-to-right when the bot pre-adds them after posting the message.
//
// Cascade-deletes with the parent panel — removing a panel removes its
// options and audit events as a single transactional act.
export const reactionRolesOption = pgTable(
  'ReactionRolesOption',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    panelId: text('panelId')
      .notNull()
      .references(() => reactionRolesPanel.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    label: text('label').notNull(),
    // Unicode character (e.g. '🇺🇸') or Discord custom-emoji reference
    // ('<:name:id>'). Custom emoji only work if the bot is in a guild that
    // exposes them — runtime 10014 from Discord is caught at the gateway
    // layer and surfaced as a 'noop' audit event.
    emoji: text('emoji').notNull(),
    roleId: text('roleId').notNull(),
    position: integer('position').notNull(),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('ReactionRolesOption_panelId_idx').on(t.panelId),
    // Identity key for reaction → option lookup. The reaction listener
    // resolves `(panelId, emoji)` to a single option; duplicate emoji on
    // the same panel would create ambiguity.
    uniqueIndex('ReactionRolesOption_panelId_emoji_key').on(t.panelId, t.emoji),
    uniqueIndex('ReactionRolesOption_panelId_position_key').on(t.panelId, t.position),
    uniqueIndex('ReactionRolesOption_panelId_label_key').on(t.panelId, t.label),
  ],
);

export const reactionRolesOptionRelations = relations(reactionRolesOption, ({ one }) => ({
  panel: one(reactionRolesPanel, {
    fields: [reactionRolesOption.panelId],
    references: [reactionRolesPanel.id],
  }),
}));
