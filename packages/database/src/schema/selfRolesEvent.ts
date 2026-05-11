import { createId } from '@paralleldrive/cuid2';
import { relations } from 'drizzle-orm';
import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { selfRolesOption } from './selfRolesOption.js';
import { selfRolesPanel } from './selfRolesPanel.js';

// Audit log of every self-roles reaction. Actions:
//   'granted' — reaction added, role assigned successfully
//   'revoked' — reaction removed, role removed successfully
//   'noop'    — reaction handled but no role change (Discord rejected the
//               role op: missing Manage Roles, role hierarchy violation,
//               unknown emoji 10014, etc.). The user keeps whatever state
//               they had before — we never half-apply.
//
// Stored as text rather than an enum so a future 'cooldown' or
// 'rate_limited' action can be added without a schema migration. Cascades
// with the parent panel and option so deleting a panel cleans up its
// history.
export const selfRolesEvent = pgTable(
  'SelfRolesEvent',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    panelId: text('panelId')
      .notNull()
      .references(() => selfRolesPanel.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    userId: text('userId').notNull(),
    optionId: text('optionId')
      .notNull()
      .references(() => selfRolesOption.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    action: text('action').notNull(),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    index('SelfRolesEvent_panelId_userId_idx').on(t.panelId, t.userId),
    index('SelfRolesEvent_createdAt_idx').on(t.createdAt),
  ],
);

export const selfRolesEventRelations = relations(selfRolesEvent, ({ one }) => ({
  panel: one(selfRolesPanel, {
    fields: [selfRolesEvent.panelId],
    references: [selfRolesPanel.id],
  }),
  option: one(selfRolesOption, {
    fields: [selfRolesEvent.optionId],
    references: [selfRolesOption.id],
  }),
}));
