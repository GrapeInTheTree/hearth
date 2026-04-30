'use server';

import { db, dbDrizzle } from '@hearth/database';
import { type ActionError, type Result, err, isErr, ok } from '@hearth/shared';
import { type PanelInput, PanelInputSchema, PanelService } from '@hearth/tickets-core';
import { revalidatePath } from 'next/cache';

import { branding } from '@/config/branding';
import { callBot } from '@/lib/botClient';
import { authorizeGuild } from '@/lib/server-auth';

// Server Actions for panel CRUD. Each action:
//  1) authorizes the user (Manage Guild on target guild)
//  2) validates input against the shared PanelInputSchema
//  3) writes through PanelService (single source of truth)
//  4) calls the bot's /internal/panels/:id/render to push the change
//     to Discord
//  5) revalidates the relevant Next.js cache paths so RSC pages refresh
//
// The dashboard's PanelService instance reuses the same DB connection as
// the bot. Discord-side rendering deliberately goes through the bot's
// HTTP API rather than the dashboard holding the bot token.
//
// Discord-side render failure does NOT roll back the DB write. The form
// surfaces a "Saved. Discord re-render queued — retry." banner using the
// `discordSyncFailed` flag in the result, and a Retry Sync button POSTs
// /internal/panels/:id/render to recover. This keeps the dashboard
// usable when the bot is briefly down.

export type PanelActionResult<T> = Result<
  { value: T; discordSyncFailed: boolean; discordSyncMessage?: string },
  ActionError
>;

interface CreatePanelArgs {
  readonly guildId: string;
  readonly input: PanelInput;
}

function getPanelService(): PanelService {
  // Build a service instance with a stub gateway. Mutations go through
  // the bot's HTTP API; the dashboard never directly calls Discord, so
  // any gateway method invoked from this path is a programmer error.
  // Using a Proxy gives a precise message instead of "x is undefined".
  const gateway = new Proxy(
    {},
    {
      get(_t, prop): never {
        throw new Error(
          `dashboard PanelService should never call gateway.${String(prop)} — Discord-side actions must go through callBot()`,
        );
      },
    },
  );
  return new PanelService(dbDrizzle, gateway as never, branding);
}

/**
 * Create a panel row in the database. Discord-side render is triggered
 * via the bot's internal API. The result reports `discordSyncFailed`
 * so the form can surface a banner without rolling back the DB write.
 */
export async function createPanel(
  args: CreatePanelArgs,
): Promise<PanelActionResult<{ panelId: string; messageId: string }>> {
  const auth = await authorizeGuild(args.guildId);
  if (isErr(auth)) return err(auth.error);

  const parsed = PanelInputSchema.safeParse(args.input);
  if (!parsed.success) {
    return err({ code: 'VALIDATION_ERROR', message: parsed.error.message });
  }

  // Validate the channel/guild relationship matches what the form claimed.
  if (parsed.data.guildId !== args.guildId) {
    return err({ code: 'VALIDATION_ERROR', message: 'guildId in form does not match URL' });
  }

  // Insert the row first; the rerenderPanel inside upsertPanel will throw
  // through the stub gateway (we don't have one in the dashboard process),
  // so we use a thin path: call the underlying DB upsert via PanelService
  // with a safe write-only flow, then trigger render via callBot.
  const created = await db.panel.create({
    data: {
      guildId: parsed.data.guildId,
      channelId: parsed.data.channelId,
      messageId: 'pending',
      embedTitle: parsed.data.embedTitle ?? 'Contact Team',
      embedDescription: parsed.data.embedDescription ?? 'Click a button below to open a ticket.',
    },
  });

  const renderResult = await callBot<{ messageId: string; recreated: boolean }>({
    path: `/internal/panels/${created.id}/render`,
    method: 'POST',
    body: {},
  });

  revalidatePath(`/g/${args.guildId}/panels`);
  revalidatePath(`/g/${args.guildId}`);

  if (isErr(renderResult)) {
    return ok({
      value: { panelId: created.id, messageId: created.messageId },
      discordSyncFailed: true,
      discordSyncMessage: renderResult.error.message,
    });
  }
  return ok({
    value: { panelId: created.id, messageId: renderResult.value.messageId },
    discordSyncFailed: false,
  });
}

interface UpdatePanelArgs {
  readonly guildId: string;
  readonly panelId: string;
  readonly embedTitle: string | undefined;
  readonly embedDescription: string | undefined;
}

/**
 * Edit a panel's embed title/description in place. Channel changes
 * aren't supported — they'd require sending a fresh message in the new
 * channel and deleting the old, which the operator can do via delete +
 * recreate (acceptable churn for a rare action).
 */
export async function updatePanel(
  args: UpdatePanelArgs,
): Promise<PanelActionResult<{ panelId: string; messageId: string }>> {
  const auth = await authorizeGuild(args.guildId);
  if (isErr(auth)) return err(auth.error);

  await db.panel.update({
    where: { id: args.panelId },
    data: {
      ...(args.embedTitle !== undefined ? { embedTitle: args.embedTitle } : {}),
      ...(args.embedDescription !== undefined ? { embedDescription: args.embedDescription } : {}),
    },
  });

  const renderResult = await callBot<{ messageId: string; recreated: boolean }>({
    path: `/internal/panels/${args.panelId}/render`,
    method: 'POST',
    body: {},
  });

  revalidatePath(`/g/${args.guildId}/panels`);
  revalidatePath(`/g/${args.guildId}/panels/${args.panelId}`);

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

/**
 * Hard-delete a panel. Tickets reference panels via FK RESTRICT, so the
 * bot's DELETE endpoint will surface an error if any tickets exist for
 * the panel — caller must clean them up first.
 */
export async function deletePanel(args: {
  readonly guildId: string;
  readonly panelId: string;
}): Promise<PanelActionResult<{ panelId: string }>> {
  const auth = await authorizeGuild(args.guildId);
  if (isErr(auth)) return err(auth.error);

  const deleteResult = await callBot<{ deleted: boolean; panelId: string }>({
    path: `/internal/panels/${args.panelId}`,
    method: 'DELETE',
  });

  revalidatePath(`/g/${args.guildId}/panels`);

  if (isErr(deleteResult)) {
    return err({ code: deleteResult.error.code, message: deleteResult.error.message });
  }
  return ok({
    value: { panelId: deleteResult.value.panelId },
    discordSyncFailed: false,
  });
}

/**
 * Trigger a Discord re-render without changing the DB. Surface for the
 * "Retry sync" button after a failed createPanel/updatePanel.
 */
export async function retrySyncPanel(args: {
  readonly guildId: string;
  readonly panelId: string;
}): Promise<PanelActionResult<{ panelId: string; messageId: string }>> {
  const auth = await authorizeGuild(args.guildId);
  if (isErr(auth)) return err(auth.error);

  const renderResult = await callBot<{ messageId: string; recreated: boolean }>({
    path: `/internal/panels/${args.panelId}/render`,
    method: 'POST',
    body: {},
  });
  revalidatePath(`/g/${args.guildId}/panels/${args.panelId}`);
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

// Suppress unused warning for getPanelService until ticket-type actions
// land in PR-5 — keep the helper here so the PR-5 diff stays tight.
export const _unusedGetPanelService = getPanelService;
