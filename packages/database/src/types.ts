import type { InferSelectModel } from 'drizzle-orm';

import type * as schema from './schema/index.js';

// Drizzle row types via InferSelectModel. Mirror what Prisma's generator
// used to emit so service code that imports `type Ticket` etc. continues
// working unchanged. Once Prisma is removed (PR-6), this becomes the only
// source.

export type GuildConfig = InferSelectModel<typeof schema.guildConfig>;
export type Panel = InferSelectModel<typeof schema.panel>;
export type PanelTicketType = InferSelectModel<typeof schema.panelTicketType>;
export type Ticket = InferSelectModel<typeof schema.ticket>;
export type TicketEvent = InferSelectModel<typeof schema.ticketEvent>;

// TicketEvent.metadata holds an arbitrary JSON object (column is `jsonb`,
// nullable). Existing prod rows mix shapes per event type — opened events
// carry `{channelId, number}`, deleted events carry a richer snapshot, etc.
// Stricter typing (e.g. a discriminated union with `kind` tag) would
// require a data migration we're not doing here. Service writes are
// reviewed at the call site; dashboard readers handle missing fields
// defensively.
export type TicketEventMetadata = Record<string, unknown>;

// TicketStatus — value object + type union, mirroring Prisma's generated
// enum surface so existing call sites (`TicketStatus.open`) keep working.
// Sourced from the schema's pgEnum values to keep DB and TS in lockstep.
export const TicketStatus = {
  open: 'open',
  claimed: 'claimed',
  closed: 'closed',
} as const;
export type TicketStatus = (typeof TicketStatus)[keyof typeof TicketStatus];
