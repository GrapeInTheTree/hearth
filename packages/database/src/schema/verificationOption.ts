import { createId } from '@paralleldrive/cuid2';
import { relations } from 'drizzle-orm';
import { index, integer, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

import { verificationPanel } from './verificationPanel.js';

// One emoji button on a verification panel. Up to 5 per panel (Discord
// action row limit). `position` orders the buttons left-to-right and is
// unique within a panel; `label` is unique so the operator UI can refer
// to options by human-readable name. `buttonStyle` is one of
// 'primary' | 'secondary' | 'success' | 'danger' (validated at the service
// layer; stored as text to keep migrations simple if Discord adds styles).
//
// Cascade-deletes with the parent panel — removing a panel removes its
// options and their events as a single transactional act.
export const verificationOption = pgTable(
  'VerificationOption',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    panelId: text('panelId')
      .notNull()
      .references(() => verificationPanel.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    label: text('label').notNull(),
    // Unicode character (e.g. '🍎') or Discord custom-emoji reference
    // ('<:name:id>'). v1 dashboard form restricts to Unicode; the column
    // is text so custom emoji becomes a service-layer feature flip later.
    emoji: text('emoji').notNull(),
    buttonStyle: text('buttonStyle').notNull(),
    // 0..4 — Discord action rows hold at most 5 buttons. The unique index
    // on (panelId, position) prevents two options from claiming the same
    // slot; the service layer rejects positions outside [0, 4].
    position: integer('position').notNull(),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('VerificationOption_panelId_idx').on(t.panelId),
    uniqueIndex('VerificationOption_panelId_position_key').on(t.panelId, t.position),
    uniqueIndex('VerificationOption_panelId_label_key').on(t.panelId, t.label),
  ],
);

export const verificationOptionRelations = relations(verificationOption, ({ one }) => ({
  panel: one(verificationPanel, {
    fields: [verificationOption.panelId],
    references: [verificationPanel.id],
  }),
}));
