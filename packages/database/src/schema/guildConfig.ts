import { integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

// Per-guild bot configuration. One row per Discord guild the bot serves.
// Mirror of the Prisma `GuildConfig` model — column names, nullability,
// defaults, and TIMESTAMP(3) precision must match exactly so prod DB stays
// untouched on cutover.
export const guildConfig = pgTable('GuildConfig', {
  guildId: text('guildId').primaryKey(),
  archiveCategoryId: text('archiveCategoryId'),
  alertChannelId: text('alertChannelId'),
  ticketCounter: integer('ticketCounter').notNull().default(0),
  defaultLocale: text('defaultLocale').notNull().default('en'),
  createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
  // Prisma's `@updatedAt` is application-side — Postgres has no DEFAULT here.
  // Drizzle services must set it explicitly on every write (PR-2a wires
  // `$defaultFn` and `$onUpdate`).
  updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' }).notNull(),
});
