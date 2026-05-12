'use server';

import { and, dbDrizzle, eq, RolePickerAction, schema, sql } from '@hearth/database';
import {
  type RolePickerOptionEdit,
  RolePickerOptionEditSchema,
  type RolePickerOptionInputType as RolePickerOptionInput,
  RolePickerOptionInputSchema,
} from '@hearth/role-picker-core';
import { type ActionError, type Result, err, isErr, ok } from '@hearth/shared';
import { revalidatePath } from 'next/cache';

import type { RolePickerActionResult } from './role-picker.js';

import { callBot } from '@/lib/botClient';
import { authorizeGuild } from '@/lib/server-auth';

// Server Actions for role-picker option CRUD. Mirror of reaction-roles
// options. Each option mutation syncs the live message — the bot edits
// the StringSelectMenu in place. Discord preserves any in-flight user
// state on the client side.

const MAX_OPTIONS_PER_PANEL = 25;

async function syncPanelToDiscord(args: {
  readonly guildId: string;
  readonly panelId: string;
}): Promise<{ failed: false } | { failed: true; message: string }> {
  const renderResult = await callBot<{ messageId: string; recreated: boolean }>({
    path: `/internal/role-picker/${args.panelId}/render`,
    method: 'POST',
    body: {},
  });
  revalidatePath(`/g/${args.guildId}/role-picker`);
  revalidatePath(`/g/${args.guildId}/role-picker/${args.panelId}`);
  if (isErr(renderResult)) {
    return { failed: true, message: renderResult.error.message };
  }
  return { failed: false };
}

export type { RolePickerActionResult };

interface AddOptionArgs {
  readonly guildId: string;
  readonly panelId: string;
  readonly input: RolePickerOptionInput;
}

/**
 * Add an option to a role-picker panel. Enforces:
 *  - panel exists in the user's guild
 *  - 25-option per-panel limit (Discord StringSelectMenu hard cap)
 *  - unique label + position + roleId within the panel
 */
export async function addRolePickerOption(
  args: AddOptionArgs,
): Promise<RolePickerActionResult<{ optionId: string }>> {
  const auth = await authorizeGuild(args.guildId);
  if (isErr(auth)) return err(auth.error);

  const parsed = RolePickerOptionInputSchema.safeParse(args.input);
  if (!parsed.success) {
    return err({ code: 'VALIDATION_ERROR', message: parsed.error.message });
  }

  const panel = await dbDrizzle.query.rolePickerPanel.findFirst({
    where: eq(schema.rolePickerPanel.id, args.panelId),
    with: { options: true },
  });
  if (panel === undefined || panel.guildId !== args.guildId) {
    return err({ code: 'NOT_FOUND', message: 'Role-picker panel not found.' });
  }
  if (panel.options.length >= MAX_OPTIONS_PER_PANEL) {
    return err({
      code: 'CONFLICT',
      message: 'A role-picker panel can have at most 25 options.',
    });
  }
  if (panel.options.some((o) => o.label === parsed.data.label)) {
    return err({
      code: 'CONFLICT',
      message: 'An option with this label already exists on this panel.',
    });
  }
  if (panel.options.some((o) => o.roleId === parsed.data.roleId)) {
    return err({
      code: 'CONFLICT',
      message: 'An option binding this role already exists on this panel.',
    });
  }
  if (panel.options.some((o) => o.position === parsed.data.position)) {
    return err({
      code: 'CONFLICT',
      message: 'An option already exists at this position.',
    });
  }

  const [created] = await dbDrizzle
    .insert(schema.rolePickerOption)
    .values({
      panelId: args.panelId,
      label: parsed.data.label,
      description: parsed.data.description ?? null,
      emoji: parsed.data.emoji ?? null,
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
  readonly input: RolePickerOptionEdit;
}

export async function updateRolePickerOption(
  args: UpdateOptionArgs,
): Promise<RolePickerActionResult<{ optionId: string }>> {
  const auth = await authorizeGuild(args.guildId);
  if (isErr(auth)) return err(auth.error);

  const parsed = RolePickerOptionEditSchema.safeParse(args.input);
  if (!parsed.success) {
    return err({ code: 'VALIDATION_ERROR', message: parsed.error.message });
  }

  const [existing] = await dbDrizzle
    .select()
    .from(schema.rolePickerOption)
    .where(eq(schema.rolePickerOption.id, args.optionId))
    .limit(1);
  if (existing === undefined || existing.panelId !== args.panelId) {
    return err({ code: 'NOT_FOUND', message: 'Option not found on this panel.' });
  }

  // Sibling collision checks
  if (parsed.data.label !== undefined && parsed.data.label !== existing.label) {
    const dup = await dbDrizzle.query.rolePickerOption.findFirst({
      where: and(
        eq(schema.rolePickerOption.panelId, args.panelId),
        eq(schema.rolePickerOption.label, parsed.data.label),
      ),
    });
    if (dup !== undefined && dup.id !== args.optionId) {
      return err({
        code: 'CONFLICT',
        message: 'An option with this label already exists on this panel.',
      });
    }
  }
  if (parsed.data.roleId !== undefined && parsed.data.roleId !== existing.roleId) {
    const dup = await dbDrizzle.query.rolePickerOption.findFirst({
      where: and(
        eq(schema.rolePickerOption.panelId, args.panelId),
        eq(schema.rolePickerOption.roleId, parsed.data.roleId),
      ),
    });
    if (dup !== undefined && dup.id !== args.optionId) {
      return err({
        code: 'CONFLICT',
        message: 'An option binding this role already exists on this panel.',
      });
    }
  }
  if (parsed.data.position !== undefined && parsed.data.position !== existing.position) {
    const dup = await dbDrizzle.query.rolePickerOption.findFirst({
      where: and(
        eq(schema.rolePickerOption.panelId, args.panelId),
        eq(schema.rolePickerOption.position, parsed.data.position),
      ),
    });
    if (dup !== undefined && dup.id !== args.optionId) {
      return err({
        code: 'CONFLICT',
        message: 'An option already exists at this position.',
      });
    }
  }

  const updates: Partial<typeof schema.rolePickerOption.$inferInsert> = {};
  if (parsed.data.label !== undefined) updates.label = parsed.data.label;
  if (parsed.data.description !== undefined) updates.description = parsed.data.description;
  if (parsed.data.emoji !== undefined) updates.emoji = parsed.data.emoji;
  if (parsed.data.roleId !== undefined) updates.roleId = parsed.data.roleId;
  if (parsed.data.position !== undefined) updates.position = parsed.data.position;

  if (Object.keys(updates).length > 0) {
    await dbDrizzle
      .update(schema.rolePickerOption)
      .set(updates)
      .where(eq(schema.rolePickerOption.id, args.optionId));
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
  /** When true, revoke the option's role from every audit-log-derived
   *  holder before the row is deleted. */
  readonly cleanupRoles?: boolean;
}

export async function removeRolePickerOption(
  args: RemoveOptionArgs,
): Promise<RolePickerActionResult<{ removedId: string; revokedCount: number }>> {
  const auth = await authorizeGuild(args.guildId);
  if (isErr(auth)) return err(auth.error);

  const [panel] = await dbDrizzle
    .select()
    .from(schema.rolePickerPanel)
    .where(eq(schema.rolePickerPanel.id, args.panelId))
    .limit(1);
  if (panel === undefined || panel.guildId !== args.guildId) {
    return err({ code: 'NOT_FOUND', message: 'Role-picker panel not found.' });
  }

  const [option] = await dbDrizzle
    .select()
    .from(schema.rolePickerOption)
    .where(eq(schema.rolePickerOption.id, args.optionId))
    .limit(1);
  if (option === undefined || option.panelId !== args.panelId) {
    return err({ code: 'NOT_FOUND', message: 'Option not found on this panel.' });
  }

  let revokedCount = 0;
  if (args.cleanupRoles === true) {
    const revoke = await callBot<{ revokedCount: number }>({
      path: `/internal/role-picker/${args.panelId}/options/${args.optionId}/revoke-holders`,
      method: 'POST',
      body: {},
    });
    if (!isErr(revoke)) revokedCount = revoke.value.revokedCount;
  }

  await dbDrizzle
    .delete(schema.rolePickerOption)
    .where(eq(schema.rolePickerOption.id, args.optionId));

  const sync = await syncPanelToDiscord({ guildId: args.guildId, panelId: args.panelId });
  if (sync.failed) {
    return ok({
      value: { removedId: args.optionId, revokedCount },
      discordSyncFailed: true,
      discordSyncMessage: sync.message,
    });
  }
  return ok({
    value: { removedId: args.optionId, revokedCount },
    discordSyncFailed: false,
  });
}

/**
 * Count of audit-log-derived holders for an option's role. Used by the
 * remove-option confirmation modal.
 */
export async function countRolePickerOptionHolders(args: {
  readonly guildId: string;
  readonly panelId: string;
  readonly optionId: string;
}): Promise<Result<number, ActionError>> {
  const auth = await authorizeGuild(args.guildId);
  if (isErr(auth)) return err(auth.error);
  const rows = await dbDrizzle
    .select({ userId: schema.rolePickerEvent.userId })
    .from(schema.rolePickerEvent)
    .where(eq(schema.rolePickerEvent.optionId, args.optionId))
    .groupBy(schema.rolePickerEvent.userId)
    .having(
      sql`SUM(CASE WHEN ${schema.rolePickerEvent.action} = ${RolePickerAction.granted} THEN 1 WHEN ${schema.rolePickerEvent.action} = ${RolePickerAction.revoked} THEN -1 ELSE 0 END) > 0`,
    );
  return ok(rows.length);
}
