import type { Prisma } from '@hearth/database';
import { type DbClient, type GuildConfig } from '@hearth/database';
import { err, ok, type Result, ValidationError } from '@hearth/shared';

import { SnowflakeSchema } from './lib/snowflake.js';

/**
 * Per-guild config service. One row per Discord guild the bot serves.
 * Methods take primitive IDs only; never accept discord.js objects.
 */
export class GuildConfigService {
  public constructor(private readonly db: DbClient) {}

  /**
   * Get the config row for a guild, creating an empty one with defaults
   * if it doesn't exist. Idempotent — concurrent calls converge.
   */
  public async getOrCreate(guildId: string): Promise<GuildConfig> {
    return await this.db.guildConfig.upsert({
      where: { guildId },
      create: { guildId },
      update: {},
    });
  }

  public async setArchiveCategory(
    guildId: string,
    categoryId: string,
  ): Promise<Result<GuildConfig, ValidationError>> {
    const validation = SnowflakeSchema.safeParse(categoryId);
    if (!validation.success) {
      return err(new ValidationError(`Invalid category id: ${validation.error.message}`));
    }
    const updated = await this.db.guildConfig.upsert({
      where: { guildId },
      create: { guildId, archiveCategoryId: categoryId },
      update: { archiveCategoryId: categoryId },
    });
    return ok(updated);
  }

  public async setLogChannel(
    guildId: string,
    channelId: string,
  ): Promise<Result<GuildConfig, ValidationError>> {
    const validation = SnowflakeSchema.safeParse(channelId);
    if (!validation.success) {
      return err(new ValidationError(`Invalid channel id: ${validation.error.message}`));
    }
    const updated = await this.db.guildConfig.upsert({
      where: { guildId },
      create: { guildId, alertChannelId: channelId },
      update: { alertChannelId: channelId },
    });
    return ok(updated);
  }

  /**
   * Atomically reserve the next ticket number for a guild. Caller MUST run
   * this inside the same transaction as the Ticket.create that uses the
   * returned number, otherwise concurrent opens can collide on
   * `Ticket.@@unique([guildId, number])`.
   */
  public async incrementTicketCounter(
    tx: Prisma.TransactionClient,
    guildId: string,
  ): Promise<number> {
    const updated = await tx.guildConfig.upsert({
      where: { guildId },
      create: { guildId, ticketCounter: 1 },
      update: { ticketCounter: { increment: 1 } },
      select: { ticketCounter: true },
    });
    return updated.ticketCounter;
  }
}
