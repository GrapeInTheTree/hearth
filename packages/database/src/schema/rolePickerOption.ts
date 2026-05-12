import { createId } from '@paralleldrive/cuid2';
import { relations } from 'drizzle-orm';
import { index, integer, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

import { rolePickerPanel } from './rolePickerPanel.js';

// One option in a role-picker dropdown. The option's `id` (cuid2) is
// ALSO the `value` we set on the `StringSelectMenuOptionBuilder` — so
// when a user picks an option, Discord echoes that id back in
// `interaction.values[]`, and the service looks it up directly.
//
// Per-option `roleId` (rather than panel-level) is the defining
// difference from VerificationOption — a panel with three options
// surfaces three different roles.
//
// `description` is the optional sub-line Discord renders under the
// label in the dropdown. `emoji` (also optional) renders left of the
// label — unicode or `<:name:id>` for custom. Unlike reaction-roles, emoji
// is NOT the identity — the cuid2 id is — so duplicate emojis on one
// panel are allowed (e.g. two 🇰🇷 options with different labels).
//
// Position orders the options top-to-bottom in the dropdown. Range
// 0..24 — Discord's StringSelectMenu hard cap is 25 options per menu.
//
// Cascade-deletes with the parent panel. Audit events SET NULL on this
// id so history survives option removal (see rolePickerEvent.ts).
export const rolePickerOption = pgTable(
  'RolePickerOption',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    panelId: text('panelId')
      .notNull()
      .references(() => rolePickerPanel.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    label: text('label').notNull(),
    description: text('description'),
    emoji: text('emoji'),
    roleId: text('roleId').notNull(),
    position: integer('position').notNull(),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('RolePickerOption_panelId_idx').on(t.panelId),
    // Label is the user-visible identifier inside one panel — duplicates
    // would be confusing in the dropdown.
    uniqueIndex('RolePickerOption_panelId_label_key').on(t.panelId, t.label),
    // Position is unique so dropdown order is deterministic.
    uniqueIndex('RolePickerOption_panelId_position_key').on(t.panelId, t.position),
    // Two options binding the same role would make the diff
    // non-deterministic (which option's id ends up in interaction.values
    // when the user "picks the role"?). Reject at the schema layer.
    uniqueIndex('RolePickerOption_panelId_roleId_key').on(t.panelId, t.roleId),
  ],
);

export const rolePickerOptionRelations = relations(rolePickerOption, ({ one }) => ({
  panel: one(rolePickerPanel, {
    fields: [rolePickerOption.panelId],
    references: [rolePickerPanel.id],
  }),
}));
