import { createId } from '@paralleldrive/cuid2';
import { relations } from 'drizzle-orm';
import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { rolePickerOption } from './rolePickerOption.js';
import { rolePickerPanel } from './rolePickerPanel.js';

// Audit log of every role-picker selection event. Actions:
//   'granted'             — option newly selected, role assigned OK
//   'revoked'             — option de-selected, role removed OK
//   'role_assign_failed'  — grant rejected by Discord (50013 / 50001 /
//                           10014 / etc.). User's prior state preserved.
//   'role_revoke_failed'  — revoke rejected by Discord. Same.
//
// Two failure variants (instead of reaction-roles' single 'noop'): the diff
// engine knows which direction failed, and operators reading the log
// want to know whether the user was supposed to gain or lose the role.
//
// Stored as text rather than an enum so future actions ('cooldown',
// 'rate_limited', etc.) can be added without a schema migration.
//
// Retention model — same as reaction-roles after Q3 (PR #41):
//   panel delete → cascade (operator removed the panel, intentional
//                  history loss; panel = retention boundary)
//   option delete → SET NULL on optionId, snapshot columns survive
//                  (operators can prune options without nuking history)
//
// `getOptionHolders` / `currentlyHeld` derivations work off
//   `SUM(CASE WHEN action='granted' THEN 1 WHEN action='revoked' THEN -1 ELSE 0 END) > 0`
// per (panelId, userId, optionId). Failure rows are neutral — they
// neither grant nor revoke. The (panelId, userId) composite index keeps
// this aggregation index-only.
export const rolePickerEvent = pgTable(
  'RolePickerEvent',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    panelId: text('panelId')
      .notNull()
      .references(() => rolePickerPanel.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    userId: text('userId').notNull(),
    // SET NULL so the row survives option deletion. Live queries that
    // need the option must `WHERE optionId IS NOT NULL`; analytics rely
    // on the snapshot columns below.
    optionId: text('optionId').references(() => rolePickerOption.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    // Snapshot of the option's label / emoji / role at event time.
    // Denormalised on write so post-delete reads still answer
    // "what did the user pick" without joining a dead row. We don't
    // back-fill on option edits — the snapshot is what the user saw
    // when they submitted.
    optionLabel: text('optionLabel'),
    optionEmoji: text('optionEmoji'),
    optionRoleId: text('optionRoleId'),
    action: text('action').notNull(),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    // `currentlyHeld` aggregation hot path: GROUP BY (panelId, userId,
    // optionId) with SUM filter. Composite index keeps it index-only.
    index('RolePickerEvent_panelId_userId_idx').on(t.panelId, t.userId),
    index('RolePickerEvent_createdAt_idx').on(t.createdAt),
    index('RolePickerEvent_optionId_idx').on(t.optionId),
  ],
);

export const rolePickerEventRelations = relations(rolePickerEvent, ({ one }) => ({
  panel: one(rolePickerPanel, {
    fields: [rolePickerEvent.panelId],
    references: [rolePickerPanel.id],
  }),
  option: one(rolePickerOption, {
    fields: [rolePickerEvent.optionId],
    references: [rolePickerOption.id],
  }),
}));
