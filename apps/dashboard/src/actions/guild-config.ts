'use server';

import { dbDrizzle, schema } from '@hearth/database';
import { type ActionError, type Result, err, isErr, ok } from '@hearth/shared';
import { SnowflakeSchema } from '@hearth/tickets-core';
import { revalidatePath } from 'next/cache';

import { authorizeGuild } from '@/lib/server-auth';

// Server Actions for /setup-equivalent operations: which Discord category
// closed tickets get archived to, and which channel receives delete-event
// modlog embeds. Mirrors apps/bot/src/services/.../guildConfigService —
// dashboard writes the same DB row the bot reads.

export type GuildConfigResult<T> = Result<T, ActionError>;

interface SetArchiveCategoryArgs {
  readonly guildId: string;
  readonly categoryId: string | null;
}

export async function setArchiveCategory(
  args: SetArchiveCategoryArgs,
): Promise<GuildConfigResult<{ guildId: string; archiveCategoryId: string | null }>> {
  const auth = await authorizeGuild(args.guildId);
  if (isErr(auth)) return err(auth.error);

  let archiveCategoryId: string | null = args.categoryId;
  if (archiveCategoryId !== null && archiveCategoryId !== '') {
    const parsed = SnowflakeSchema.safeParse(archiveCategoryId);
    if (!parsed.success) {
      return err({
        code: 'VALIDATION_ERROR',
        message: 'archive category must be a Discord snowflake',
      });
    }
    archiveCategoryId = parsed.data;
  } else {
    archiveCategoryId = null;
  }

  await dbDrizzle
    .insert(schema.guildConfig)
    .values({ guildId: args.guildId, archiveCategoryId })
    .onConflictDoUpdate({
      target: schema.guildConfig.guildId,
      set: { archiveCategoryId, updatedAt: new Date() },
    });

  revalidatePath(`/g/${args.guildId}/settings`);
  return ok({ guildId: args.guildId, archiveCategoryId });
}

interface SetLogChannelArgs {
  readonly guildId: string;
  readonly channelId: string | null;
}

export async function setLogChannel(
  args: SetLogChannelArgs,
): Promise<GuildConfigResult<{ guildId: string; alertChannelId: string | null }>> {
  const auth = await authorizeGuild(args.guildId);
  if (isErr(auth)) return err(auth.error);

  let alertChannelId: string | null = args.channelId;
  if (alertChannelId !== null && alertChannelId !== '') {
    const parsed = SnowflakeSchema.safeParse(alertChannelId);
    if (!parsed.success) {
      return err({
        code: 'VALIDATION_ERROR',
        message: 'log channel must be a Discord snowflake',
      });
    }
    alertChannelId = parsed.data;
  } else {
    alertChannelId = null;
  }

  await dbDrizzle
    .insert(schema.guildConfig)
    .values({ guildId: args.guildId, alertChannelId })
    .onConflictDoUpdate({
      target: schema.guildConfig.guildId,
      set: { alertChannelId, updatedAt: new Date() },
    });

  revalidatePath(`/g/${args.guildId}/settings`);
  return ok({ guildId: args.guildId, alertChannelId });
}
