'use server';

import { dbDrizzle, eq, schema } from '@hearth/database';
import { type SelfRolesPanelInput, SelfRolesPanelInputSchema } from '@hearth/self-roles-core';
import { type ActionError, type Result, err, isErr, ok } from '@hearth/shared';
import { revalidatePath } from 'next/cache';

// Server Actions for self-roles panel CRUD. Pipeline mirrors the
// verification actions:
//  1) authorize the user (Manage Guild on target guild)
//  2) validate input via the shared zod schema
//  3) write to the DB directly (single source of truth — same DB the bot
//     uses); Discord-side rendering goes through the bot's HTTP API.
//  4) revalidate Next.js cache paths so RSC pages refresh.
//
// Discord-side render failure does NOT roll back the DB write — the form
// surfaces a "Saved. Discord re-render queued" banner using the
// `discordSyncFailed` flag, and a Retry Sync action recovers.

import { callBot } from '@/lib/botClient';
import { authorizeGuild } from '@/lib/server-auth';

export type SelfRolesActionResult<T> = Result<
  { value: T; discordSyncFailed: boolean; discordSyncMessage?: string },
  ActionError
>;

interface CreatePanelArgs {
  readonly guildId: string;
  readonly input: SelfRolesPanelInput;
}

/**
 * Create a self-roles panel placeholder. Discord render is NOT triggered
 * yet — operators usually add options first then publish via Repost.
 */
export async function createSelfRolesPanel(
  args: CreatePanelArgs,
): Promise<SelfRolesActionResult<{ panelId: string }>> {
  const auth = await authorizeGuild(args.guildId);
  if (isErr(auth)) return err(auth.error);

  const parsed = SelfRolesPanelInputSchema.safeParse(args.input);
  if (!parsed.success) {
    return err({ code: 'VALIDATION_ERROR', message: parsed.error.message });
  }
  if (parsed.data.guildId !== args.guildId) {
    return err({ code: 'VALIDATION_ERROR', message: 'guildId in form does not match URL' });
  }

  const [created] = await dbDrizzle
    .insert(schema.selfRolesPanel)
    .values({
      guildId: parsed.data.guildId,
      channelId: parsed.data.channelId,
      messageId: 'pending',
      embedTitle: parsed.data.embedTitle ?? 'Select your roles',
      embedDescription:
        parsed.data.embedDescription ??
        'React to this message with the emoji that matches a role you want. Remove your reaction to give the role back.',
    })
    .returning();
  if (created === undefined) {
    return err({ code: 'INTERNAL_ERROR', message: 'Failed to create self-roles panel row' });
  }

  revalidatePath(`/g/${args.guildId}/self-roles`);

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
}

export async function updateSelfRolesPanel(
  args: UpdatePanelArgs,
): Promise<SelfRolesActionResult<{ panelId: string }>> {
  const auth = await authorizeGuild(args.guildId);
  if (isErr(auth)) return err(auth.error);

  const updates: Partial<typeof schema.selfRolesPanel.$inferInsert> = {};
  if (args.channelId !== undefined) updates.channelId = args.channelId;
  if (args.embedTitle !== undefined) updates.embedTitle = args.embedTitle;
  if (args.embedDescription !== undefined) updates.embedDescription = args.embedDescription;
  if (Object.keys(updates).length > 0) {
    await dbDrizzle
      .update(schema.selfRolesPanel)
      .set(updates)
      .where(eq(schema.selfRolesPanel.id, args.panelId));
  }

  const renderResult = await callBot<{ messageId: string; recreated: boolean }>({
    path: `/internal/self-roles/${args.panelId}/render`,
    method: 'POST',
    body: {},
  });

  revalidatePath(`/g/${args.guildId}/self-roles`);
  revalidatePath(`/g/${args.guildId}/self-roles/${args.panelId}`);

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

export async function deleteSelfRolesPanel(args: {
  readonly guildId: string;
  readonly panelId: string;
}): Promise<SelfRolesActionResult<{ panelId: string }>> {
  const auth = await authorizeGuild(args.guildId);
  if (isErr(auth)) return err(auth.error);

  const deleteResult = await callBot<{ deleted: boolean; panelId: string }>({
    path: `/internal/self-roles/${args.panelId}`,
    method: 'DELETE',
  });

  revalidatePath(`/g/${args.guildId}/self-roles`);

  if (isErr(deleteResult)) {
    return err({ code: deleteResult.error.code, message: deleteResult.error.message });
  }
  return ok({
    value: { panelId: deleteResult.value.panelId },
    discordSyncFailed: false,
  });
}

export async function repostSelfRolesPanel(args: {
  readonly guildId: string;
  readonly panelId: string;
}): Promise<SelfRolesActionResult<{ panelId: string; messageId: string }>> {
  const auth = await authorizeGuild(args.guildId);
  if (isErr(auth)) return err(auth.error);

  const result = await callBot<{ messageId: string; previousMessageId: string }>({
    path: `/internal/self-roles/${args.panelId}/repost`,
    method: 'POST',
    body: {},
  });
  revalidatePath(`/g/${args.guildId}/self-roles/${args.panelId}`);
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

export async function retrySyncSelfRolesPanel(args: {
  readonly guildId: string;
  readonly panelId: string;
}): Promise<SelfRolesActionResult<{ panelId: string; messageId: string }>> {
  const auth = await authorizeGuild(args.guildId);
  if (isErr(auth)) return err(auth.error);

  const renderResult = await callBot<{ messageId: string; recreated: boolean }>({
    path: `/internal/self-roles/${args.panelId}/render`,
    method: 'POST',
    body: {},
  });
  revalidatePath(`/g/${args.guildId}/self-roles/${args.panelId}`);
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
