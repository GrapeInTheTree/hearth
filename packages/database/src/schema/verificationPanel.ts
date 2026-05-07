import { createId } from '@paralleldrive/cuid2';
import { relations } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

import { verificationOption } from './verificationOption.js';

// A verification panel — one Discord message with up to 5 emoji buttons.
// Users click buttons to attempt verification; the option whose id matches
// `correctOptionId` grants the role at `roleId`. The (guildId, channelId,
// messageId) triple is unique so we can safely look up "which panel does
// this message belong to" from a button click.
//
// `correctOptionId` is nullable to break the FK cycle with VerificationOption
// (panel → option → panel). The service layer enforces the runtime invariant
// that a published panel must have a non-null correctOptionId — admins set
// it explicitly via /verification set-correct or the dashboard.
export const verificationPanel = pgTable(
  'VerificationPanel',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    guildId: text('guildId').notNull(),
    channelId: text('channelId').notNull(),
    // Set to a placeholder until the bot posts the message and writes back
    // the real Discord message id. Same pattern as Panel.messageId.
    messageId: text('messageId').notNull(),
    embedTitle: text('embedTitle').notNull(),
    embedDescription: text('embedDescription').notNull(),
    // The role the bot grants on a correct submission. Single role per
    // panel in v1; future per-option-different-role would add a nullable
    // column on VerificationOption without breaking the existing column.
    roleId: text('roleId').notNull(),
    // Nullable — the FK cycle (panel.correctOptionId → option.id;
    // option.panelId → panel.id) is broken by inserting the panel first
    // with NULL, then the options, then UPDATE the panel. Service-layer
    // checks publish-readiness instead of relying on a NOT NULL constraint.
    correctOptionId: text('correctOptionId'),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('VerificationPanel_guildId_idx').on(t.guildId),
    uniqueIndex('VerificationPanel_guildId_channelId_messageId_key').on(
      t.guildId,
      t.channelId,
      t.messageId,
    ),
  ],
);

export const verificationPanelRelations = relations(verificationPanel, ({ many }) => ({
  options: many(verificationOption),
}));
