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
    id: text('id').primaryKey(),
    panelId: text('panelId')
      .notNull()
      .references(() => panel.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    name: text('name').notNull(),
    emoji: text('emoji').notNull(),
    buttonStyle: text('buttonStyle').notNull(),
    buttonLabel: text('buttonLabel'),
    buttonOrder: integer('buttonOrder').notNull().default(0),
    activeCategoryId: text('activeCategoryId').notNull(),
    supportRoleIds: text('supportRoleIds').array(),
    pingRoleIds: text('pingRoleIds').array(),
    perUserLimit: integer('perUserLimit'),
    welcomeMessage: text('welcomeMessage'),
  },
  (t) => [index('PanelTicketType_panelId_idx').on(t.panelId)],
);

export const panelTicketTypeRelations = relations(panelTicketType, ({ many, one }) => ({
  panel: one(panel, { fields: [panelTicketType.panelId], references: [panel.id] }),
  tickets: many(ticket),
}));
