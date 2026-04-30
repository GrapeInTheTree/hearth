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
  // Set on every write to mirror Prisma's @updatedAt — application-side,
  // no Postgres DEFAULT (matches the existing prod migration).
  updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdate(() => new Date()),
});
