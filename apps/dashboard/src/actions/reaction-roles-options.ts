'use server';

import { and, dbDrizzle, eq, schema } from '@hearth/database';
import {
  type ReactionRolesOptionEdit,
  ReactionRolesOptionEditSchema,
  type ReactionRolesOptionInputType as ReactionRolesOptionInput,
  ReactionRolesOptionInputSchema,
} from '@hearth/reaction-roles-core';
import { type ActionError, type Result, err, isErr, ok } from '@hearth/shared';
import { revalidatePath } from 'next/cache';

import type { ReactionRolesActionResult } from './reaction-roles.js';

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
    path: `/internal/reaction-roles/${args.panelId}/render`,
    method: 'POST',
    body: {},
  });
  revalidatePath(`/g/${args.guildId}/reaction-roles`);
  revalidatePath(`/g/${args.guildId}/reaction-roles/${args.panelId}`);
  if (isErr(renderResult)) {
    return { failed: true, message: renderResult.error.message };
  }
  return { failed: false };
}

const MAX_OPTIONS_PER_PANEL = 20;

export type { ReactionRolesActionResult };

interface AddOptionArgs {
  readonly guildId: string;
  readonly panelId: string;
  readonly input: ReactionRolesOptionInput;
}

/**
 * Add an emoji-role binding to a reaction-roles panel. Enforces:
 *  - the panel exists in the user's guild
 *  - 10-option per-panel limit
 *  - unique label + emoji + position within the panel
 *
 * Discord re-render is NOT triggered here — operators usually add several
 * options at once and the form's "Save & Publish" button repost the panel
 * explicitly. Re-rendering after each option would race the bot's reaction
 * seeding loop.
 */
export async function addReactionRolesOption(
  args: AddOptionArgs,
): Promise<ReactionRolesActionResult<{ optionId: string }>> {
  const auth = await authorizeGuild(args.guildId);
  if (isErr(auth)) return err(auth.error);

  const parsed = ReactionRolesOptionInputSchema.safeParse(args.input);
  if (!parsed.success) {
    return err({ code: 'VALIDATION_ERROR', message: parsed.error.message });
  }

  const panel = await dbDrizzle.query.reactionRolesPanel.findFirst({
    where: eq(schema.reactionRolesPanel.id, args.panelId),
    with: { options: true },
  });
  if (panel === undefined || panel.guildId !== args.guildId) {
    return err({ code: 'NOT_FOUND', message: 'Self-roles panel not found.' });
  }
  if (panel.options.length >= MAX_OPTIONS_PER_PANEL) {
    return err({
      code: 'CONFLICT',
      message: 'A reaction-roles panel can have at most 20 options.',
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
    .insert(schema.reactionRolesOption)
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
  readonly input: ReactionRolesOptionEdit;
}

export async function updateReactionRolesOption(
  args: UpdateOptionArgs,
): Promise<ReactionRolesActionResult<{ optionId: string }>> {
  const auth = await authorizeGuild(args.guildId);
  if (isErr(auth)) return err(auth.error);

  const parsed = ReactionRolesOptionEditSchema.safeParse(args.input);
  if (!parsed.success) {
    return err({ code: 'VALIDATION_ERROR', message: parsed.error.message });
  }

  const [existing] = await dbDrizzle
    .select()
    .from(schema.reactionRolesOption)
    .where(eq(schema.reactionRolesOption.id, args.optionId))
    .limit(1);
  if (existing === undefined || existing.panelId !== args.panelId) {
    return err({ code: 'NOT_FOUND', message: 'Option not found on this panel.' });
  }

  // Sibling collision checks — only the columns the operator is changing.
  if (parsed.data.label !== undefined && parsed.data.label !== existing.label) {
    const dup = await dbDrizzle.query.reactionRolesOption.findFirst({
      where: and(
        eq(schema.reactionRolesOption.panelId, args.panelId),
        eq(schema.reactionRolesOption.label, parsed.data.label),
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
    const dup = await dbDrizzle.query.reactionRolesOption.findFirst({
      where: and(
        eq(schema.reactionRolesOption.panelId, args.panelId),
        eq(schema.reactionRolesOption.emoji, parsed.data.emoji),
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
    const dup = await dbDrizzle.query.reactionRolesOption.findFirst({
      where: and(
        eq(schema.reactionRolesOption.panelId, args.panelId),
        eq(schema.reactionRolesOption.position, parsed.data.position),
      ),
    });
    if (dup !== undefined && dup.id !== args.optionId) {
      return err({
        code: 'CONFLICT',
        message: 'An option already exists at this position.',
      });
    }
  }

  const updates: Partial<typeof schema.reactionRolesOption.$inferInsert> = {};
  if (parsed.data.label !== undefined) updates.label = parsed.data.label;
  if (parsed.data.emoji !== undefined) updates.emoji = parsed.data.emoji;
  if (parsed.data.roleId !== undefined) updates.roleId = parsed.data.roleId;
  if (parsed.data.position !== undefined) updates.position = parsed.data.position;

  if (Object.keys(updates).length > 0) {
    await dbDrizzle
      .update(schema.reactionRolesOption)
      .set(updates)
      .where(eq(schema.reactionRolesOption.id, args.optionId));
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
  /** When true, also revoke the option's role from every audit-log-derived
   *  holder before the row is deleted. The confirmation modal uses
   *  countReactionRolesOptionHolders to surface the affected user count
   *  before the operator opts in. */
  readonly cleanupRoles?: boolean;
}

export async function removeReactionRolesOption(
  args: RemoveOptionArgs,
): Promise<ReactionRolesActionResult<{ removedId: string; revokedCount: number }>> {
  const auth = await authorizeGuild(args.guildId);
  if (isErr(auth)) return err(auth.error);

  const [panel] = await dbDrizzle
    .select()
    .from(schema.reactionRolesPanel)
    .where(eq(schema.reactionRolesPanel.id, args.panelId))
    .limit(1);
  if (panel === undefined || panel.guildId !== args.guildId) {
    return err({ code: 'NOT_FOUND', message: 'Self-roles panel not found.' });
  }

  const [option] = await dbDrizzle
    .select()
    .from(schema.reactionRolesOption)
    .where(eq(schema.reactionRolesOption.id, args.optionId))
    .limit(1);
  if (option === undefined || option.panelId !== args.panelId) {
    return err({ code: 'NOT_FOUND', message: 'Option not found on this panel.' });
  }

  // Role revokes run on the bot before the DB delete so the audit log
  // (which is about to cascade away with the option) is still
  // queryable for the holder list. The bot endpoint reads the same
  // ReactionRolesEvent table and walks the holders sequentially — one HTTP
  // round-trip from here regardless of how many holders there are.
  let revokedCount = 0;
  if (args.cleanupRoles === true) {
    const revoke = await callBot<{ revokedCount: number }>({
      path: `/internal/reaction-roles/${args.panelId}/options/${args.optionId}/revoke-holders`,
      method: 'POST',
      body: {},
    });
    if (!isErr(revoke)) revokedCount = revoke.value.revokedCount;
  }

  await dbDrizzle
    .delete(schema.reactionRolesOption)
    .where(eq(schema.reactionRolesOption.id, args.optionId));

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
 * remove-option confirmation modal so operators see "X users currently
 * hold this role" before opting into a cleanup-on-delete.
 */
export async function countReactionRolesOptionHolders(args: {
  readonly guildId: string;
  readonly panelId: string;
  readonly optionId: string;
}): Promise<Result<number, ActionError>> {
  const auth = await authorizeGuild(args.guildId);
  if (isErr(auth)) return err(auth.error);
  const holders = await getOptionHolders(args.optionId);
  return ok(holders.length);
}

async function getOptionHolders(optionId: string): Promise<readonly string[]> {
  const events = await dbDrizzle
    .select({
      userId: schema.reactionRolesEvent.userId,
      action: schema.reactionRolesEvent.action,
    })
    .from(schema.reactionRolesEvent)
    .where(eq(schema.reactionRolesEvent.optionId, optionId));
  const netByUser = new Map<string, number>();
  for (const e of events) {
    const delta = e.action === 'granted' ? 1 : e.action === 'revoked' ? -1 : 0;
    if (delta !== 0) netByUser.set(e.userId, (netByUser.get(e.userId) ?? 0) + delta);
  }
  const holders: string[] = [];
  for (const [userId, net] of netByUser) {
    if (net > 0) holders.push(userId);
  }
  return holders;
}
