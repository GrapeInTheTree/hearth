import { type DbDrizzle, type DbDrizzleTx, type GuildConfig, schema, sql } from '@hearth/database';
import { err, ok, type Result, ValidationError } from '@hearth/shared';

import { SnowflakeSchema } from './lib/snowflake.js';

// Service operations may run on either the root client or inside a
// transaction (e.g. `incrementTicketCounter` invoked from
// `withAdvisoryLock`'s tx callback). Both have the same query surface.
type Querier = DbDrizzle | DbDrizzleTx;

/**
 * Per-guild config service. One row per Discord guild the bot serves.
 * Methods take primitive IDs only; never accept discord.js objects.
 */
export class GuildConfigService {
  public constructor(private readonly db: DbDrizzle) {}

  /**
   * Get the config row for a guild, creating an empty one with defaults
   * if it doesn't exist. Idempotent — concurrent calls converge.
   */
  public async getOrCreate(guildId: string): Promise<GuildConfig> {
    const [row] = await this.db
      .insert(schema.guildConfig)
      .values({ guildId })
      .onConflictDoUpdate({
        target: schema.guildConfig.guildId,
        // Empty SET would emit no UPDATE clause; touching `updatedAt`
        // ensures DO UPDATE runs and `RETURNING *` yields the row.
        set: { updatedAt: new Date() },
      })
      .returning();
    if (row === undefined) {
      throw new Error(`Failed to upsert GuildConfig for ${guildId}`);
    }
    return row;
  }

  public async setArchiveCategory(
    guildId: string,
    categoryId: string,
  ): Promise<Result<GuildConfig, ValidationError>> {
    const validation = SnowflakeSchema.safeParse(categoryId);
    if (!validation.success) {
      return err(new ValidationError(`Invalid category id: ${validation.error.message}`));
    }
    const [row] = await this.db
      .insert(schema.guildConfig)
      .values({ guildId, archiveCategoryId: categoryId })
      .onConflictDoUpdate({
        target: schema.guildConfig.guildId,
        set: { archiveCategoryId: categoryId, updatedAt: new Date() },
      })
      .returning();
    if (row === undefined) {
      throw new Error(`Failed to upsert GuildConfig.archiveCategoryId for ${guildId}`);
    }
    return ok(row);
  }

  public async setLogChannel(
    guildId: string,
    channelId: string,
  ): Promise<Result<GuildConfig, ValidationError>> {
    const validation = SnowflakeSchema.safeParse(channelId);
    if (!validation.success) {
      return err(new ValidationError(`Invalid channel id: ${validation.error.message}`));
    }
    const [row] = await this.db
      .insert(schema.guildConfig)
      .values({ guildId, alertChannelId: channelId })
      .onConflictDoUpdate({
        target: schema.guildConfig.guildId,
        set: { alertChannelId: channelId, updatedAt: new Date() },
      })
      .returning();
    if (row === undefined) {
      throw new Error(`Failed to upsert GuildConfig.alertChannelId for ${guildId}`);
    }
    return ok(row);
  }

  /**
   * Atomically reserve the next ticket number for a guild. Caller MUST
   * pass the same `tx` it uses for the subsequent `Ticket.insert`,
   * otherwise concurrent opens can collide on
   * `Ticket.@@unique([guildId, number])`. The counter increments via
   * `INSERT … ON CONFLICT DO UPDATE … SET ticketCounter = … + 1` so the
   * read+write is one statement (no race window).
   */
  public async incrementTicketCounter(tx: Querier, guildId: string): Promise<number> {
    const [row] = await tx
      .insert(schema.guildConfig)
      .values({ guildId, ticketCounter: 1 })
      .onConflictDoUpdate({
        target: schema.guildConfig.guildId,
        set: {
          ticketCounter: sql`${schema.guildConfig.ticketCounter} + 1`,
          updatedAt: new Date(),
        },
      })
      .returning({ ticketCounter: schema.guildConfig.ticketCounter });
    if (row === undefined) {
      throw new Error(`Failed to increment ticket counter for ${guildId}`);
    }
    return row.ticketCounter;
  }
}
