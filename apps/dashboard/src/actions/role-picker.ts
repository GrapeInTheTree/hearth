'use server';

import { dbDrizzle, eq, schema } from '@hearth/database';
import {
  buildRolePickerCustomId,
  type RolePickerPanelInput,
  RolePickerPanelInputSchema,
} from '@hearth/role-picker-core';
import { type ActionError, type Result, err, isErr, ok } from '@hearth/shared';
import { createId } from '@paralleldrive/cuid2';
import { revalidatePath } from 'next/cache';

import { callBot } from '@/lib/botClient';
import { authorizeGuild } from '@/lib/server-auth';

// Server Actions for role-picker panel CRUD. Pipeline mirrors the
// reaction-roles + verification actions exactly:
//   1) authorize via Manage Guild on the target guild
//   2) validate input via the shared zod schema
//   3) write to DB (single source of truth — same DB the bot uses)
//   4) trigger Discord render via the bot's HTTP API; failures land
//      as discordSyncFailed flags rather than rolling back DB writes
//   5) revalidate the Next.js cache paths so RSC pages refresh
//
// Renders DO surface ValidationError specifically — Discord rejects
// empty StringSelectMenu payloads, so the dashboard wants to tell the
// operator "add an option first" rather than just "sync failed".

export type RolePickerActionResult<T> = Result<
  { value: T; discordSyncFailed: boolean; discordSyncMessage?: string },
  ActionError
>;

interface CreatePanelArgs {
  readonly guildId: string;
  readonly input: RolePickerPanelInput;
}

/**
 * Create a role-picker panel placeholder. Discord render is NOT
 * triggered yet — operators add options first, then publish via
 * Repost (or implicit render via the next option mutation).
 */
export async function createRolePickerPanel(
  args: CreatePanelArgs,
): Promise<RolePickerActionResult<{ panelId: string }>> {
  const auth = await authorizeGuild(args.guildId);
  if (isErr(auth)) return err(auth.error);

  const parsed = RolePickerPanelInputSchema.safeParse(args.input);
  if (!parsed.success) {
    return err({ code: 'VALIDATION_ERROR', message: parsed.error.message });
  }
  if (parsed.data.guildId !== args.guildId) {
    return err({ code: 'VALIDATION_ERROR', message: 'guildId in form does not match URL' });
  }

  // Pre-allocate the panel id so we can build the customId before
  // insert. The id is the StringSelectMenu's anchor — service-side
  // createPanel does the same, so DB shape is identical to the bot
  // path (no drift).
  const panelId = createId();
  const customId = buildRolePickerCustomId(panelId);

  const [created] = await dbDrizzle
    .insert(schema.rolePickerPanel)
    .values({
      id: panelId,
      guildId: parsed.data.guildId,
      channelId: parsed.data.channelId,
      messageId: 'pending',
      embedTitle: parsed.data.embedTitle ?? 'Pick your role',
      embedDescription:
        parsed.data.embedDescription ?? 'Open the dropdown below and pick the option you want.',
      placeholder: parsed.data.placeholder ?? 'Pick a role…',
      selectionMode: parsed.data.selectionMode ?? 'single',
      minValues: parsed.data.minValues ?? 1,
      maxValues: parsed.data.maxValues ?? 1,
      customId,
    })
    .returning();
  if (created === undefined) {
    return err({ code: 'INTERNAL_ERROR', message: 'Failed to create role-picker panel row' });
  }

  revalidatePath(`/g/${args.guildId}/role-picker`);

  return ok({
    value: { panelId: created.id },
    discordSyncFailed: false,
  });
}

interface UpdatePanelArgs {
  readonly guildId: string;
  readonly panelId: string;
  readonly channelId: string | undefined;
  readonly embedTitle: string | undefined;
  readonly embedDescription: string | undefined;
  readonly placeholder: string | undefined;
}

export async function updateRolePickerPanel(
  args: UpdatePanelArgs,
): Promise<RolePickerActionResult<{ panelId: string }>> {
  const auth = await authorizeGuild(args.guildId);
  if (isErr(auth)) return err(auth.error);

  const updates: Partial<typeof schema.rolePickerPanel.$inferInsert> = {};
  if (args.channelId !== undefined) updates.channelId = args.channelId;
  if (args.embedTitle !== undefined) updates.embedTitle = args.embedTitle;
  if (args.embedDescription !== undefined) updates.embedDescription = args.embedDescription;
  if (args.placeholder !== undefined) updates.placeholder = args.placeholder;
  if (Object.keys(updates).length > 0) {
    await dbDrizzle
      .update(schema.rolePickerPanel)
      .set(updates)
      .where(eq(schema.rolePickerPanel.id, args.panelId));
  }

  const renderResult = await callBot<{ messageId: string; recreated: boolean }>({
    path: `/internal/role-picker/${args.panelId}/render`,
    method: 'POST',
    body: {},
  });

  revalidatePath(`/g/${args.guildId}/role-picker`);
  revalidatePath(`/g/${args.guildId}/role-picker/${args.panelId}`);

  if (isErr(renderResult)) {
    return ok({
      value: { panelId: args.panelId },
      discordSyncFailed: true,
      discordSyncMessage: renderResult.error.message,
    });
  }

  return ok({
    value: { panelId: args.panelId },
    discordSyncFailed: false,
  });
}

export async function deleteRolePickerPanel(args: {
  readonly guildId: string;
  readonly panelId: string;
}): Promise<RolePickerActionResult<{ panelId: string }>> {
  const auth = await authorizeGuild(args.guildId);
  if (isErr(auth)) return err(auth.error);

  const deleteResult = await callBot<{ deleted: boolean; panelId: string }>({
    path: `/internal/role-picker/${args.panelId}`,
    method: 'DELETE',
  });

  revalidatePath(`/g/${args.guildId}/role-picker`);

  if (isErr(deleteResult)) {
    return err({ code: deleteResult.error.code, message: deleteResult.error.message });
  }
  return ok({
    value: { panelId: deleteResult.value.panelId },
    discordSyncFailed: false,
  });
}

export async function repostRolePickerPanel(args: {
  readonly guildId: string;
  readonly panelId: string;
}): Promise<RolePickerActionResult<{ panelId: string; messageId: string }>> {
  const auth = await authorizeGuild(args.guildId);
  if (isErr(auth)) return err(auth.error);

  const result = await callBot<{ messageId: string; previousMessageId: string }>({
    path: `/internal/role-picker/${args.panelId}/repost`,
    method: 'POST',
    body: {},
  });
  revalidatePath(`/g/${args.guildId}/role-picker/${args.panelId}`);
  if (isErr(result)) {
    return ok({
      value: { panelId: args.panelId, messageId: '' },
      discordSyncFailed: true,
      discordSyncMessage: result.error.message,
    });
  }
  return ok({
    value: { panelId: args.panelId, messageId: result.value.messageId },
    discordSyncFailed: false,
  });
}

export async function retrySyncRolePickerPanel(args: {
  readonly guildId: string;
  readonly panelId: string;
}): Promise<RolePickerActionResult<{ panelId: string; messageId: string }>> {
  const auth = await authorizeGuild(args.guildId);
  if (isErr(auth)) return err(auth.error);

  const renderResult = await callBot<{ messageId: string; recreated: boolean }>({
    path: `/internal/role-picker/${args.panelId}/render`,
    method: 'POST',
    body: {},
  });
  revalidatePath(`/g/${args.guildId}/role-picker/${args.panelId}`);
  if (isErr(renderResult)) {
    return ok({
      value: { panelId: args.panelId, messageId: '' },
      discordSyncFailed: true,
      discordSyncMessage: renderResult.error.message,
    });
  }
  return ok({
    value: { panelId: args.panelId, messageId: renderResult.value.messageId },
    discordSyncFailed: false,
  });
}
