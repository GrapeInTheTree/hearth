import { pgEnum } from 'drizzle-orm/pg-core';

// Mirrors Prisma's `enum TicketStatus { open claimed closed }`. The literal
// array drives both the pgEnum type and the TypeScript union — keep them in
// sync. Adding a new status requires a Postgres `ALTER TYPE` migration.
export const TicketStatusValues = ['open', 'claimed', 'closed'] as const;
export type TicketStatus = (typeof TicketStatusValues)[number];

export const ticketStatusEnum = pgEnum('TicketStatus', TicketStatusValues);
