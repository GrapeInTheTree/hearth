import cuid from 'cuid';
import { relations } from 'drizzle-orm';
import { index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { ticket } from './ticket.js';

// Append-only audit trail: every state transition (opened/claimed/closed/
// reopened/deleted/channel-deleted-externally) + arbitrary metadata.
// Cascade-deletes with the parent Ticket — `delete` writes a final
// `deleted` event before the cascade so the modlog snapshot survives in
// any external archive.
//
// `metadata` is JSONB without NOT NULL — matches Prisma's `Json?` column
// shape. Service layer types it via `$type<TicketEventMetadata>()` (PR-2a).
export const ticketEvent = pgTable(
  'TicketEvent',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => cuid()),
    ticketId: text('ticketId')
      .notNull()
      .references(() => ticket.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    type: text('type').notNull(),
    actorId: text('actorId').notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [index('TicketEvent_ticketId_createdAt_idx').on(t.ticketId, t.createdAt)],
);

export const ticketEventRelations = relations(ticketEvent, ({ one }) => ({
  ticket: one(ticket, { fields: [ticketEvent.ticketId], references: [ticket.id] }),
}));
