import { createId } from '@paralleldrive/cuid2';
import { relations } from 'drizzle-orm';
import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { verificationOption } from './verificationOption.js';
import { verificationPanel } from './verificationPanel.js';

// Audit log of every verification button click. Outcomes:
//   'success'              — correct option, role granted
//   'wrong_answer'         — incorrect option clicked
//   'already_verified'     — correct option, but the user already had the role
//   'role_assign_failed'   — correct option, but Discord rejected the assign
//                            (missing permission, role hierarchy, etc.)
//
// Stored as text rather than an enum so adding new outcomes (e.g. cooldown
// rejection later) doesn't require a schema migration. Cascades with the
// parent panel and option so deleting a panel cleans up its event history.
export const verificationEvent = pgTable(
  'VerificationEvent',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    panelId: text('panelId')
      .notNull()
      .references(() => verificationPanel.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    userId: text('userId').notNull(),
    optionId: text('optionId')
      .notNull()
      .references(() => verificationOption.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    outcome: text('outcome').notNull(),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    index('VerificationEvent_panelId_userId_idx').on(t.panelId, t.userId),
    index('VerificationEvent_createdAt_idx').on(t.createdAt),
  ],
);

export const verificationEventRelations = relations(verificationEvent, ({ one }) => ({
  panel: one(verificationPanel, {
    fields: [verificationEvent.panelId],
    references: [verificationPanel.id],
  }),
  option: one(verificationOption, {
    fields: [verificationEvent.optionId],
    references: [verificationOption.id],
  }),
}));
