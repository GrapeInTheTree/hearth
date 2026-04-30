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

// ─── Prisma (legacy — removed in PR-6) ────────────────────────────────
// Kept exported so dashboard RSC pages and the legacy direct-`db.X`
// Server Actions still compile. PR-3 migrates them to the Drizzle
// surface above; PR-6 then drops these exports along with the
// `@prisma/client` dependency.
export { db, type DbClient } from './client.js';
export { Prisma, PrismaClient } from './generated/client/client.js';
