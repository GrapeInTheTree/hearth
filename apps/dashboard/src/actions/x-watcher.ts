'use server';

import { dbDrizzle } from '@hearth/database';
import { type ActionError, err, isErr, ok, type Result, toActionError } from '@hearth/shared';
import { XWatcherInputSchema, XWatcherService, type PollSummary } from '@hearth/x-watcher-core';
import { revalidatePath } from 'next/cache';

import { callBot } from '@/lib/botClient';
import { authorizeGuild } from '@/lib/server-auth';

// Server Actions for X-watcher CRUD. Unlike the panel domains, creating /
// editing a watcher does NOT trigger a Discord render — the bot posts
// links on its own poll schedule, not on watcher mutation. So these
// actions are pure DB writes (via XWatcherService, the same service the
// bot uses) plus cache revalidation. The one bot round-trip is "Poll now",
// which asks the bot to run a single watcher immediately.

const service = new XWatcherService(dbDrizzle);

export type XWatcherActionResult<T> = Result<T, ActionError>;

export async function createWatcher(args: {
  readonly guildId: string;
  readonly sourceHandle: string;
  readonly channelId: string;
  readonly includeQuotes: boolean;
  readonly includeReplies: boolean;
}): Promise<XWatcherActionResult<{ watcherId: string }>> {
  const auth = await authorizeGuild(args.guildId);
  if (isErr(auth)) return err(auth.error);

  const parsed = XWatcherInputSchema.safeParse({
    guildId: args.guildId,
    sourceHandle: args.sourceHandle,
    channelId: args.channelId,
    includeQuotes: args.includeQuotes,
    includeReplies: args.includeReplies,
  });
  if (!parsed.success) {
    return err({ code: 'VALIDATION_ERROR', message: parsed.error.message });
  }

  const result = await service.createWatcher({
    guildId: parsed.data.guildId,
    sourceHandle: parsed.data.sourceHandle,
    channelId: parsed.data.channelId,
    // The toggles arrive as concrete booleans from the form; take them
    // from args (the zod-parsed copies are typed boolean|undefined because
    // the schema marks them optional, which trips exactOptionalPropertyTypes).
    includeQuotes: args.includeQuotes,
    includeReplies: args.includeReplies,
  });
  if (isErr(result)) return err(toActionError(result.error));

  revalidatePath(`/g/${args.guildId}/x-watcher`);
  return ok({ watcherId: result.value.id });
}

export async function updateWatcher(args: {
  readonly guildId: string;
  readonly watcherId: string;
  readonly channelId: string;
  readonly includeQuotes: boolean;
  readonly includeReplies: boolean;
}): Promise<XWatcherActionResult<{ watcherId: string }>> {
  const auth = await authorizeGuild(args.guildId);
  if (isErr(auth)) return err(auth.error);

  const result = await service.editWatcher(args.watcherId, {
    channelId: args.channelId,
    includeQuotes: args.includeQuotes,
    includeReplies: args.includeReplies,
  });
  if (isErr(result)) return err(toActionError(result.error));

  revalidatePath(`/g/${args.guildId}/x-watcher`);
  revalidatePath(`/g/${args.guildId}/x-watcher/${args.watcherId}`);
  return ok({ watcherId: result.value.id });
}

export async function setWatcherEnabled(args: {
  readonly guildId: string;
  readonly watcherId: string;
  readonly enabled: boolean;
}): Promise<XWatcherActionResult<{ watcherId: string; enabled: boolean }>> {
  const auth = await authorizeGuild(args.guildId);
  if (isErr(auth)) return err(auth.error);

  const result = await service.setEnabled(args.watcherId, args.enabled);
  if (isErr(result)) return err(toActionError(result.error));

  revalidatePath(`/g/${args.guildId}/x-watcher`);
  revalidatePath(`/g/${args.guildId}/x-watcher/${args.watcherId}`);
  return ok({ watcherId: result.value.id, enabled: result.value.enabled });
}

export async function deleteWatcher(args: {
  readonly guildId: string;
  readonly watcherId: string;
}): Promise<XWatcherActionResult<{ watcherId: string }>> {
  const auth = await authorizeGuild(args.guildId);
  if (isErr(auth)) return err(auth.error);

  const result = await service.deleteWatcher(args.watcherId);
  if (isErr(result)) return err(toActionError(result.error));

  revalidatePath(`/g/${args.guildId}/x-watcher`);
  return ok({ watcherId: result.value.watcherId });
}

/**
 * "Poll now" — ask the bot to run this watcher's poll immediately instead
 * of waiting for the next interval. Returns the bot's poll summary so the
 * UI can report what happened (seeded / posted / skipped / nothing-new).
 */
export async function pollWatcherNow(args: {
  readonly guildId: string;
  readonly watcherId: string;
}): Promise<XWatcherActionResult<PollSummary>> {
  const auth = await authorizeGuild(args.guildId);
  if (isErr(auth)) return err(auth.error);

  const result = await callBot<PollSummary>({
    path: `/internal/x-watcher/${args.watcherId}/poll`,
    method: 'POST',
    body: {},
  });

  revalidatePath(`/g/${args.guildId}/x-watcher/${args.watcherId}`);
  if (isErr(result)) {
    return err({ code: result.error.code, message: result.error.message });
  }
  return ok(result.value);
}
