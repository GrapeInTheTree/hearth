import { relations } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

import { panelTicketType } from './panelTicketType.js';
import { ticket } from './ticket.js';

// A panel message (embed + button) posted to a public channel. One panel
// pins to one Discord message; the (guildId, channelId, messageId) triple
// is unique. Tickets reference panels via FK with RESTRICT so a panel with
// open/closed tickets cannot be deleted accidentally.
export const panel = pgTable(
  'Panel',
  {
    id: text('id').primaryKey(),
    guildId: text('guildId').notNull(),
    channelId: text('channelId').notNull(),
    messageId: text('messageId').notNull(),
    embedTitle: text('embedTitle').notNull(),
    embedDescription: text('embedDescription').notNull(),
    embedColor: text('embedColor'),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' }).notNull(),
  },
  (t) => [
    index('Panel_guildId_idx').on(t.guildId),
    uniqueIndex('Panel_guildId_channelId_messageId_key').on(t.guildId, t.channelId, t.messageId),
  ],
);

export const panelRelations = relations(panel, ({ many }) => ({
  ticketTypes: many(panelTicketType),
  tickets: many(ticket),
}));
