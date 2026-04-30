import { createId } from '@paralleldrive/cuid2';
import { relations, sql } from 'drizzle-orm';
import { index, integer, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

import { ticketStatusEnum } from './_enums.js';
import { panel } from './panel.js';
import { panelTicketType } from './panelTicketType.js';
import { ticketEvent } from './ticketEvent.js';

// A live or archived ticket. status drives button enable/disable + channel
// category. `welcomeMessageId` is the pinned message we edit on every state
// change. FKs are RESTRICT so a referenced Panel/PanelTicketType cannot be
// orphan-deleted; service layer enforces the lifecycle.
//
// Race-condition guard (`ticket_open_dedupe`): at most one
// (guildId, openerId, panelTypeId) can hold status in ('open','claimed') at
// any time. Postgres partial unique index closes the race between the
// pre-flight `SELECT existing` and the `INSERT` in TicketService.openTicket.
// Belt-and-suspenders with `withAdvisoryLock` (PR-7).
export const ticket = pgTable(
  'Ticket',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    guildId: text('guildId').notNull(),
    panelId: text('panelId')
      .notNull()
      .references(() => panel.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    panelTypeId: text('panelTypeId')
      .notNull()
      .references(() => panelTicketType.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    channelId: text('channelId').notNull(),
    welcomeMessageId: text('welcomeMessageId'),
    number: integer('number').notNull(),
    openerId: text('openerId').notNull(),
    claimedById: text('claimedById'),
    status: ticketStatusEnum('status').notNull().default('open'),
    openedAt: timestamp('openedAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
    claimedAt: timestamp('claimedAt', { precision: 3, mode: 'date' }),
    closedAt: timestamp('closedAt', { precision: 3, mode: 'date' }),
    closedById: text('closedById'),
    closeReason: text('closeReason'),
  },
  (t) => [
    uniqueIndex('Ticket_channelId_key').on(t.channelId),
    index('Ticket_guildId_status_idx').on(t.guildId, t.status),
    index('Ticket_openerId_status_idx').on(t.openerId, t.status),
    uniqueIndex('Ticket_guildId_number_key').on(t.guildId, t.number),
    uniqueIndex('ticket_open_dedupe')
      .on(t.guildId, t.openerId, t.panelTypeId)
      .where(sql`status IN ('open', 'claimed')`),
  ],
);

export const ticketRelations = relations(ticket, ({ many, one }) => ({
  panel: one(panel, { fields: [ticket.panelId], references: [panel.id] }),
  panelType: one(panelTicketType, {
    fields: [ticket.panelTypeId],
    references: [panelTicketType.id],
  }),
  events: many(ticketEvent),
}));
