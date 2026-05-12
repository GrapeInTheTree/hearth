import { createId } from '@paralleldrive/cuid2';
import { relations } from 'drizzle-orm';
import { index, integer, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

import { rolePickerOption } from './rolePickerOption.js';

// A role-picker panel — one Discord message that surfaces a
// StringSelectMenu dropdown. Each option in the dropdown is bound to a
// role. Selecting an option grants the option's role; re-opening the
// dropdown and picking a different one revokes the previous and grants
// the new (handleSelection diffs against the user's currently-held
// roles, derived from the audit log).
//
// v1 is single-select only: `selectionMode='single'`, `minValues=1`,
// `maxValues=1`. The columns are stored explicitly so v2 (multi-select)
// is a dashboard-only change with no migration. Service code is written
// to handle N selections — single is just the case where the diff
// produces at most one grant + one revoke per submission.
//
// `customId` is the StringSelectMenu's identity in the interaction
// event. Encoded once at create time as `role-picker:submit|{panelId}`
// and stored so the bot can validate before processing each submission.
//
// The (guildId, channelId, messageId) triple is unique so panel lookup
// from a stale messageId stays exact. messageId + customId both have
// their own indexes — messageId is the hot path for the bot's reverse
// lookup before processing a selection.
export const rolePickerPanel = pgTable(
  'RolePickerPanel',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    guildId: text('guildId').notNull(),
    channelId: text('channelId').notNull(),
    // Placeholder until the bot posts the message and writes back the
    // real Discord message id. Same pattern as Panel / VerificationPanel
    // / ReactionRolesPanel.
    messageId: text('messageId').notNull(),
    embedTitle: text('embedTitle').notNull(),
    embedDescription: text('embedDescription').notNull(),
    // The "no selection yet" chrome inside the dropdown ("Pick a role…").
    // Discord shows this whenever the user hasn't selected on the
    // current page load.
    placeholder: text('placeholder').notNull(),
    // 'single' for v1; 'multi' reserved for v2. Stored as text rather
    // than an enum so a future 'exclusive_group' or similar can be
    // added without a migration.
    selectionMode: text('selectionMode').notNull().default('single'),
    // Discord's StringSelectMenu min/max values. v1 locks both to 1
    // via the dashboard form; the schema accepts any int >= 0 so v2
    // multi-select unlocks without touching the DB.
    minValues: integer('minValues').notNull().default(1),
    maxValues: integer('maxValues').notNull().default(1),
    // Encoded customId for the StringSelectMenu component. Immutable
    // after first render — the bot uses it to recover the panel from
    // the interaction event before doing anything else.
    customId: text('customId').notNull(),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('RolePickerPanel_guildId_idx').on(t.guildId),
    // Selection listener lookup: every submission hits
    // `SELECT … WHERE messageId = ?` first to recover the panel before
    // diffing values.
    index('RolePickerPanel_messageId_idx').on(t.messageId),
    // Backup lookup path if we ever stop embedding panelId in the
    // customId payload. Cheap to keep.
    index('RolePickerPanel_customId_idx').on(t.customId),
    uniqueIndex('RolePickerPanel_guildId_channelId_messageId_key').on(
      t.guildId,
      t.channelId,
      t.messageId,
    ),
  ],
);

export const rolePickerPanelRelations = relations(rolePickerPanel, ({ many }) => ({
  options: many(rolePickerOption),
}));
