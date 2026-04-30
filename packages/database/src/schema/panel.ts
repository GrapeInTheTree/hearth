import cuid from 'cuid';
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
    // Application-side cuid v1, matching the existing prod IDs from Prisma's
    // `@default(cuid())`. PR-8 swaps this for `@paralleldrive/cuid2` (still
    // application-side, only the generator function changes).
    id: text('id')
      .primaryKey()
      .$defaultFn(() => cuid()),
    guildId: text('guildId').notNull(),
    channelId: text('channelId').notNull(),
    messageId: text('messageId').notNull(),
    embedTitle: text('embedTitle').notNull(),
    embedDescription: text('embedDescription').notNull(),
    embedColor: text('embedColor'),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
    // Set on every write (insert + update) to mirror Prisma's @updatedAt.
    updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdate(() => new Date()),
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
