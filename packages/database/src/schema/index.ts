// Drizzle schema barrel. The Drizzle client takes this whole namespace
// (`drizzle(pool, { schema })`) so the relational query API can resolve
// `db.query.ticket.findFirst({ with: { events: true } })` etc. Anything
// downstream — services, fakeDb, dashboard RSC — imports either named
// tables (`import { ticket } from '@hearth/database/schema'`) or the
// whole namespace (`import { schema } from '@hearth/database'`).
//
// PR-1 ships this surface dormant: nothing in apps/* or packages/* (other
// than this package's own future migration tooling) imports it yet.

export { ticketStatusEnum, TicketStatusValues, type TicketStatus } from './_enums.js';

export { guildConfig } from './guildConfig.js';
export { panel, panelRelations } from './panel.js';
export { panelTicketType, panelTicketTypeRelations } from './panelTicketType.js';
export { ticket, ticketRelations } from './ticket.js';
export { ticketEvent, ticketEventRelations } from './ticketEvent.js';
