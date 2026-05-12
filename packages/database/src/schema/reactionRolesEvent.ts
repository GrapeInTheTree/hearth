import { createId } from '@paralleldrive/cuid2';
import { relations } from 'drizzle-orm';
import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { reactionRolesOption } from './reactionRolesOption.js';
import { reactionRolesPanel } from './reactionRolesPanel.js';

// Audit log of every reaction-roles reaction. Actions:
//   'granted' — reaction added, role assigned successfully
//   'revoked' — reaction removed, role removed successfully
//   'noop'    — reaction handled but no role change (Discord rejected the
//               role op: missing Manage Roles, role hierarchy violation,
//               unknown emoji 10014, etc.). The user keeps whatever state
//               they had before — we never half-apply.
//
// Stored as text rather than an enum so a future 'cooldown' or
// 'rate_limited' action can be added without a schema migration.
//
// Retention model: panel-level deletes cascade (operator removed the
// whole panel, lose its history is intentional). Option-level deletes
// SET NULL on optionId so the per-event audit row survives — we
// denormalise the option's label/emoji/role onto the row at write
// time so post-delete queries can still answer "what did this user
// react with two months ago." `getOptionHolders` lives on the option
// table (FK still required there because the holder query only makes
// sense while the option exists), but historical analytics work off
// the snapshots.
export const reactionRolesEvent = pgTable(
  'ReactionRolesEvent',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    panelId: text('panelId')
      .notNull()
      .references(() => reactionRolesPanel.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    userId: text('userId').notNull(),
    // SET NULL so the audit row survives option deletion. Queries that
    // need a live option must `WHERE optionId IS NOT NULL`; historical
    // analytics can rely on the snapshot columns below.
    optionId: text('optionId').references(() => reactionRolesOption.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    // Snapshot of the option's label / emoji / role at event time.
    // Denormalised on write so deletes don't lose readability. We don't
    // try to back-fill on option edits — the snapshot represents the
    // option as the user saw it the instant they reacted, not as it
    // exists now.
    optionLabel: text('optionLabel'),
    optionEmoji: text('optionEmoji'),
    optionRoleId: text('optionRoleId'),
    action: text('action').notNull(),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    index('ReactionRolesEvent_panelId_userId_idx').on(t.panelId, t.userId),
    index('ReactionRolesEvent_createdAt_idx').on(t.createdAt),
    index('ReactionRolesEvent_optionId_idx').on(t.optionId),
  ],
);

export const reactionRolesEventRelations = relations(reactionRolesEvent, ({ one }) => ({
  panel: one(reactionRolesPanel, {
    fields: [reactionRolesEvent.panelId],
    references: [reactionRolesPanel.id],
  }),
  option: one(reactionRolesOption, {
    fields: [reactionRolesEvent.optionId],
    references: [reactionRolesOption.id],
  }),
}));
