// Public surface of @hearth/database. Single source of truth — nothing
// downstream imports from `@prisma/client`, `drizzle-orm/*`, or the
// generated/schema folders directly.
//
// Migration period: Prisma + Drizzle coexist. PR-2a wires Drizzle through
// services + bot container.ts; PR-3 migrates dashboard call sites; PR-6
// removes Prisma. The model row types (`Ticket`, `Panel`, …) and the
// `TicketStatus` value+type are sourced from Drizzle's `InferSelectModel`
// — Prisma's generated types are structurally identical so existing call
// sites keep compiling unchanged through the swap.

// ─── Drizzle (primary going forward) ──────────────────────────────────
export { dbDrizzle, type DbDrizzle, type DbDrizzleTx } from './client.drizzle.js';
export * as schema from './schema/index.js';
export {
  type GuildConfig,
  type Panel,
  type PanelTicketType,
  type Ticket,
  type TicketEvent,
  type TicketEventMetadata,
  TicketStatus,
} from './types.js';
export { TicketStatusValues } from './schema/_enums.js';
export { and, asc, count, desc, eq, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';
export {
  getConstraintName,
  isForeignKeyViolation,
  isLockNotAvailable,
  isUniqueViolation,
} from './errors.js';

// Prisma exports were dropped in PR-3 — every caller (services, bot
// container, dashboard RSC pages, dashboard Server Actions, integration
// tests) now uses the Drizzle surface above. PR-6 deletes the residual
// Prisma generator output (`prisma/`, `src/generated/`, `client.ts`)
// and removes `@prisma/client` from the lockfile.
