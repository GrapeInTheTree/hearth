import { createId } from '@paralleldrive/cuid2';
import { relations } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

import { selfRolesOption } from './selfRolesOption.js';

// A self-roles panel — one Discord message that surfaces N emoji reactions.
// Each reaction is bound to its own role (per-option roleId on
// SelfRolesOption). Adding a reaction grants the option's role; removing
// the reaction revokes it. Multi-select is native — a user holding 🇺🇸 + 🇰🇷
// has both roles. There is no concept of a "correct" option here (unlike
// VerificationPanel) — every option is a valid self-assignment.
//
// The (guildId, channelId, messageId) triple is unique so reaction lookup
// from messageId → panel is exact. A dedicated messageId index speeds the
// hot path of every reaction event entering the bot.
export const selfRolesPanel = pgTable(
  'SelfRolesPanel',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    guildId: text('guildId').notNull(),
    channelId: text('channelId').notNull(),
    // Placeholder until the bot posts the message and writes back the real
    // Discord message id. Same pattern as Panel.messageId and
    // VerificationPanel.messageId.
    messageId: text('messageId').notNull(),
    embedTitle: text('embedTitle').notNull(),
    embedDescription: text('embedDescription').notNull(),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('SelfRolesPanel_guildId_idx').on(t.guildId),
    // Hot-path index: every reaction event in the bot's guilds funnels
    // through `SELECT … WHERE messageId = ?`. Without this index the
    // reaction listener would full-scan the table on every flag click.
    index('SelfRolesPanel_messageId_idx').on(t.messageId),
    uniqueIndex('SelfRolesPanel_guildId_channelId_messageId_key').on(
      t.guildId,
      t.channelId,
      t.messageId,
    ),
  ],
);

export const selfRolesPanelRelations = relations(selfRolesPanel, ({ many }) => ({
  options: many(selfRolesOption),
}));
