'use server';

import { and, dbDrizzle, eq, schema } from '@hearth/database';
import {
  type SelfRolesOptionEdit,
  SelfRolesOptionEditSchema,
  type SelfRolesOptionInputType as SelfRolesOptionInput,
  SelfRolesOptionInputSchema,
} from '@hearth/self-roles-core';
import { err, isErr, ok } from '@hearth/shared';
import { revalidatePath } from 'next/cache';

import type { SelfRolesActionResult } from './self-roles.js';

import { callBot } from '@/lib/botClient';
import { authorizeGuild } from '@/lib/server-auth';

/**
 * After every option mutation we sync the live message: the bot edits the
 * embed in place and re-seeds the reaction strip with the current options.
 * Discord no-ops bot reactions it already has, so existing user reactions
 * (and granted roles) survive — operators never need a destructive repost
 * just to add a flag. Bot reactions for removed options stay as harmless
 * orphans (clicks miss the (panelId, emoji) lookup → silent noop).
 *
 * Errors here don't roll back the DB write — `discordSyncFailed` surfaces
 * a banner and the operator can retry sync from the panel detail page.
 */
async function syncPanelToDiscord(args: {
  readonly guildId: string;
  readonly panelId: string;
}): Promise<{ failed: false } | { failed: true; message: string }> {
  const renderResult = await callBot<{ messageId: string; recreated: boolean }>({
    path: `/internal/self-roles/${args.panelId}/render`,
    method: 'POST',
    body: {},
  });
  revalidatePath(`/g/${args.guildId}/self-roles`);
  revalidatePath(`/g/${args.guildId}/self-roles/${args.panelId}`);
  if (isErr(renderResult)) {
    return { failed: true, message: renderResult.error.message };
  }
  return { failed: false };
}

const MAX_OPTIONS_PER_PANEL = 20;

export type { SelfRolesActionResult };

interface AddOptionArgs {
  readonly guildId: string;
  readonly panelId: string;
  readonly input: SelfRolesOptionInput;
}

/**
 * Add an emoji-role binding to a self-roles panel. Enforces:
 *  - the panel exists in the user's guild
 *  - 10-option per-panel limit
 *  - unique label + emoji + position within the panel
 *
 * Discord re-render is NOT triggered here — operators usually add several
 * options at once and the form's "Save & Publish" button repost the panel
 * explicitly. Re-rendering after each option would race the bot's reaction
 * seeding loop.
 */
export async function addSelfRolesOption(
  args: AddOptionArgs,
): Promise<SelfRolesActionResult<{ optionId: string }>> {
  const auth = await authorizeGuild(args.guildId);
  if (isErr(auth)) return err(auth.error);

  const parsed = SelfRolesOptionInputSchema.safeParse(args.input);
  if (!parsed.success) {
    return err({ code: 'VALIDATION_ERROR', message: parsed.error.message });
  }

  const panel = await dbDrizzle.query.selfRolesPanel.findFirst({
    where: eq(schema.selfRolesPanel.id, args.panelId),
    with: { options: true },
  });
  if (panel === undefined || panel.guildId !== args.guildId) {
    return err({ code: 'NOT_FOUND', message: 'Self-roles panel not found.' });
  }
  if (panel.options.length >= MAX_OPTIONS_PER_PANEL) {
    return err({
      code: 'CONFLICT',
      message: 'A self-roles panel can have at most 20 options.',
    });
  }
  if (panel.options.some((o) => o.label === parsed.data.label)) {
    return err({
      code: 'CONFLICT',
      message: 'An option with this label already exists on this panel.',
    });
  }
  if (panel.options.some((o) => o.emoji === parsed.data.emoji)) {
    return err({
      code: 'CONFLICT',
      message: 'An option with this emoji already exists on this panel.',
    });
  }
  if (panel.options.some((o) => o.position === parsed.data.position)) {
    return err({
      code: 'CONFLICT',
      message: 'An option already exists at this position.',
    });
  }

  const [created] = await dbDrizzle
    .insert(schema.selfRolesOption)
    .values({
      panelId: args.panelId,
      label: parsed.data.label,
      emoji: parsed.data.emoji,
      roleId: parsed.data.roleId,
      position: parsed.data.position,
    })
    .returning();
  if (created === undefined) {
    return err({ code: 'INTERNAL_ERROR', message: 'Failed to insert option.' });
  }

  const sync = await syncPanelToDiscord({ guildId: args.guildId, panelId: args.panelId });
  if (sync.failed) {
    return ok({
      value: { optionId: created.id },
      discordSyncFailed: true,
      discordSyncMessage: sync.message,
    });
  }
  return ok({
    value: { optionId: created.id },
    discordSyncFailed: false,
  });
}

interface UpdateOptionArgs {
  readonly guildId: string;
  readonly panelId: string;
  readonly optionId: string;
  readonly input: SelfRolesOptionEdit;
}

export async function updateSelfRolesOption(
  args: UpdateOptionArgs,
): Promise<SelfRolesActionResult<{ optionId: string }>> {
  const auth = await authorizeGuild(args.guildId);
  if (isErr(auth)) return err(auth.error);

  const parsed = SelfRolesOptionEditSchema.safeParse(args.input);
  if (!parsed.success) {
    return err({ code: 'VALIDATION_ERROR', message: parsed.error.message });
  }

  const [existing] = await dbDrizzle
    .select()
    .from(schema.selfRolesOption)
    .where(eq(schema.selfRolesOption.id, args.optionId))
    .limit(1);
  if (existing === undefined || existing.panelId !== args.panelId) {
    return err({ code: 'NOT_FOUND', message: 'Option not found on this panel.' });
  }

  // Sibling collision checks — only the columns the operator is changing.
  if (parsed.data.label !== undefined && parsed.data.label !== existing.label) {
    const dup = await dbDrizzle.query.selfRolesOption.findFirst({
      where: and(
        eq(schema.selfRolesOption.panelId, args.panelId),
        eq(schema.selfRolesOption.label, parsed.data.label),
      ),
    });
    if (dup !== undefined && dup.id !== args.optionId) {
      return err({
        code: 'CONFLICT',
        message: 'An option with this label already exists on this panel.',
      });
    }
  }
  if (parsed.data.emoji !== undefined && parsed.data.emoji !== existing.emoji) {
    const dup = await dbDrizzle.query.selfRolesOption.findFirst({
      where: and(
        eq(schema.selfRolesOption.panelId, args.panelId),
        eq(schema.selfRolesOption.emoji, parsed.data.emoji),
      ),
    });
    if (dup !== undefined && dup.id !== args.optionId) {
      return err({
        code: 'CONFLICT',
        message: 'An option with this emoji already exists on this panel.',
      });
    }
  }
  if (parsed.data.position !== undefined && parsed.data.position !== existing.position) {
    const dup = await dbDrizzle.query.selfRolesOption.findFirst({
      where: and(
        eq(schema.selfRolesOption.panelId, args.panelId),
        eq(schema.selfRolesOption.position, parsed.data.position),
      ),
    });
    if (dup !== undefined && dup.id !== args.optionId) {
      return err({
        code: 'CONFLICT',
        message: 'An option already exists at this position.',
      });
    }
  }

  const updates: Partial<typeof schema.selfRolesOption.$inferInsert> = {};
  if (parsed.data.label !== undefined) updates.label = parsed.data.label;
  if (parsed.data.emoji !== undefined) updates.emoji = parsed.data.emoji;
  if (parsed.data.roleId !== undefined) updates.roleId = parsed.data.roleId;
  if (parsed.data.position !== undefined) updates.position = parsed.data.position;

  if (Object.keys(updates).length > 0) {
    await dbDrizzle
      .update(schema.selfRolesOption)
      .set(updates)
      .where(eq(schema.selfRolesOption.id, args.optionId));
  }

  const sync = await syncPanelToDiscord({ guildId: args.guildId, panelId: args.panelId });
  if (sync.failed) {
    return ok({
      value: { optionId: args.optionId },
      discordSyncFailed: true,
      discordSyncMessage: sync.message,
    });
  }
  return ok({
    value: { optionId: args.optionId },
    discordSyncFailed: false,
  });
}

interface RemoveOptionArgs {
  readonly guildId: string;
  readonly panelId: string;
  readonly optionId: string;
}

export async function removeSelfRolesOption(
  args: RemoveOptionArgs,
): Promise<SelfRolesActionResult<{ removedId: string }>> {
  const auth = await authorizeGuild(args.guildId);
  if (isErr(auth)) return err(auth.error);

  const [panel] = await dbDrizzle
    .select()
    .from(schema.selfRolesPanel)
    .where(eq(schema.selfRolesPanel.id, args.panelId))
    .limit(1);
  if (panel === undefined || panel.guildId !== args.guildId) {
    return err({ code: 'NOT_FOUND', message: 'Self-roles panel not found.' });
  }

  await dbDrizzle
    .delete(schema.selfRolesOption)
    .where(eq(schema.selfRolesOption.id, args.optionId));

  const sync = await syncPanelToDiscord({ guildId: args.guildId, panelId: args.panelId });
  if (sync.failed) {
    return ok({
      value: { removedId: args.optionId },
      discordSyncFailed: true,
      discordSyncMessage: sync.message,
    });
  }
  return ok({
    value: { removedId: args.optionId },
    discordSyncFailed: false,
  });
}
