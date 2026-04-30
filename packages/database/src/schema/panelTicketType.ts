import cuid from 'cuid';
import { relations } from 'drizzle-orm';
import { index, integer, pgTable, text } from 'drizzle-orm/pg-core';

import { panel } from './panel.js';
import { ticket } from './ticket.js';

// One ticket type per panel (e.g. 'support', 'offer'). Carries category
// placement, support roles, ping targets, per-user concurrency limit, and
// optional welcome message override. Cascade-deletes with the parent
// Panel — removing a panel removes its types as a single transactional act.
//
// supportRoleIds / pingRoleIds are TEXT[] without NOT NULL — matches the
// Prisma column shape exactly. Application code always writes arrays
// (never null) and reads with `?? []` defensively.
export const panelTicketType = pgTable(
  'PanelTicketType',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => cuid()),
    panelId: text('panelId')
      .notNull()
      .references(() => panel.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    name: text('name').notNull(),
    emoji: text('emoji').notNull(),
    buttonStyle: text('buttonStyle').notNull(),
    buttonLabel: text('buttonLabel'),
    buttonOrder: integer('buttonOrder').notNull().default(0),
    activeCategoryId: text('activeCategoryId').notNull(),
    // Prisma's `String[]` column was nullable at the Postgres level (the
    // generator doesn't emit NOT NULL for arrays) but the application has
    // always written arrays, never null. The Drizzle schema enforces the
    // real invariant — TEXT[] NOT NULL — so the inferred row type is
    // `string[]` without nulls. Existing prod rows have no NULL values,
    // so PR-4 baseline migration's `SET NOT NULL` ALTER applies cleanly.
    supportRoleIds: text('supportRoleIds').array().notNull(),
    pingRoleIds: text('pingRoleIds').array().notNull(),
    perUserLimit: integer('perUserLimit'),
    welcomeMessage: text('welcomeMessage'),
  },
  (t) => [index('PanelTicketType_panelId_idx').on(t.panelId)],
);

export const panelTicketTypeRelations = relations(panelTicketType, ({ many, one }) => ({
  panel: one(panel, { fields: [panelTicketType.panelId], references: [panel.id] }),
  tickets: many(ticket),
}));
