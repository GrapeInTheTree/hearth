'use server';

import { count, dbDrizzle, eq, schema } from '@hearth/database';
import { type ActionError, type Result, err, isErr, ok } from '@hearth/shared';
import { type TicketTypeInput, TicketTypeInputSchema } from '@hearth/tickets-core';
import { revalidatePath } from 'next/cache';

import { callBot } from '@/lib/botClient';
import { authorizeGuild } from '@/lib/server-auth';

// Server Actions for ticket-type CRUD. Mirrors actions/panels.ts:
//  1) authorize Manage Guild
//  2) validate input against shared zod schema
//  3) write DB row(s) directly (we duplicate the constraint checks
//     PanelService does, rather than call the service through a
//     dashboard-side gateway that can't render Discord)
//  4) call /internal/panels/:panelId/render to push to Discord
//  5) revalidate Next.js paths so RSC pages refresh
//
// All `err(...)` returns ship a plain `ActionError` ({ code, message })
// rather than an AppError class instance — Next.js 15's flight serializer
// otherwise replaces the Error with a `$Z` placeholder + redacted message
// in production builds, hiding our user-facing copy from the toast.

export type TypeActionResult<T> = Result<
  { value: T; discordSyncFailed: boolean; discordSyncMessage?: string },
  ActionError
>;

interface AddTypeArgs {
  readonly guildId: string;
  readonly input: TicketTypeInput;
}

export async function addTicketType(
  args: AddTypeArgs,
): Promise<TypeActionResult<{ typeId: string; panelId: string }>> {
  const auth = await authorizeGuild(args.guildId);
  if (isErr(auth)) return err(auth.error);

  const parsed = TicketTypeInputSchema.safeParse(args.input);
  if (!parsed.success) {
    return err({ code: 'VALIDATION_ERROR', message: parsed.error.message });
  }

  const panel = await dbDrizzle.query.panel.findFirst({
    where: eq(schema.panel.id, parsed.data.panelId),
    with: { ticketTypes: { columns: { name: true } } },
  });
  if (panel === undefined || panel.guildId !== args.guildId) {
    return err({
      code: 'NOT_FOUND',
      message: `Panel ${parsed.data.panelId} not found in this guild`,
    });
  }
  if (panel.ticketTypes.some((t) => t.name === parsed.data.name)) {
    return err({
      code: 'CONFLICT',
      message: `Ticket type '${parsed.data.name}' already exists on this panel`,
    });
  }

  const [created] = await dbDrizzle
    .insert(schema.panelTicketType)
    .values({
      panelId: parsed.data.panelId,
      name: parsed.data.name,
      buttonLabel: parsed.data.label,
      emoji: parsed.data.emoji,
      buttonStyle: parsed.data.buttonStyle ?? 'success',
      buttonOrder: parsed.data.buttonOrder ?? panel.ticketTypes.length,
      activeCategoryId: parsed.data.activeCategoryId,
      supportRoleIds: [...parsed.data.supportRoleIds],
      pingRoleIds: [...parsed.data.pingRoleIds],
      perUserLimit: parsed.data.perUserLimit,
      welcomeMessage: parsed.data.welcomeMessage ?? null,
    })
    .returning();
  if (created === undefined) {
    return err({ code: 'INTERNAL_ERROR', message: 'Failed to insert ticket type' });
  }

  const renderResult = await callBot<{ messageId: string; recreated: boolean }>({
    path: `/internal/panels/${parsed.data.panelId}/render`,
    method: 'POST',
    body: {},
  });

  revalidatePath(`/g/${args.guildId}/panels/${parsed.data.panelId}`);
  revalidatePath(`/g/${args.guildId}/panels`);

  if (isErr(renderResult)) {
    return ok({
      value: { typeId: created.id, panelId: created.panelId },
      discordSyncFailed: true,
      discordSyncMessage: renderResult.error.message,
    });
  }
  return ok({
    value: { typeId: created.id, panelId: created.panelId },
    discordSyncFailed: false,
  });
}

interface EditTypeArgs {
  readonly guildId: string;
  readonly typeId: string;
  readonly fields: Partial<{
    label: string;
    emoji: string;
    buttonStyle: 'primary' | 'secondary' | 'success' | 'danger';
    buttonOrder: number;
    activeCategoryId: string;
    supportRoleIds: readonly string[];
    pingRoleIds: readonly string[];
    perUserLimit: number | null;
    welcomeMessage: string | null;
  }>;
}

export async function editTicketType(
  args: EditTypeArgs,
): Promise<TypeActionResult<{ typeId: string; panelId: string }>> {
  const auth = await authorizeGuild(args.guildId);
  if (isErr(auth)) return err(auth.error);

  const existing = await dbDrizzle.query.panelTicketType.findFirst({
    where: eq(schema.panelTicketType.id, args.typeId),
    with: { panel: { columns: { guildId: true, id: true } } },
  });
  if (existing === undefined || existing.panel.guildId !== args.guildId) {
    return err({
      code: 'NOT_FOUND',
      message: `Ticket type ${args.typeId} not found in this guild`,
    });
  }

  const updates: Partial<typeof schema.panelTicketType.$inferInsert> = {};
  if (args.fields.label !== undefined) updates.buttonLabel = args.fields.label;
  if (args.fields.emoji !== undefined) updates.emoji = args.fields.emoji;
  if (args.fields.buttonStyle !== undefined) updates.buttonStyle = args.fields.buttonStyle;
  if (args.fields.buttonOrder !== undefined) updates.buttonOrder = args.fields.buttonOrder;
  if (args.fields.activeCategoryId !== undefined) {
    updates.activeCategoryId = args.fields.activeCategoryId;
  }
  if (args.fields.supportRoleIds !== undefined) {
    updates.supportRoleIds = [...args.fields.supportRoleIds];
  }
  if (args.fields.pingRoleIds !== undefined) {
    updates.pingRoleIds = [...args.fields.pingRoleIds];
  }
  if (args.fields.perUserLimit !== undefined) updates.perUserLimit = args.fields.perUserLimit;
  if (args.fields.welcomeMessage !== undefined) updates.welcomeMessage = args.fields.welcomeMessage;

  if (Object.keys(updates).length > 0) {
    await dbDrizzle
      .update(schema.panelTicketType)
      .set(updates)
      .where(eq(schema.panelTicketType.id, args.typeId));
  }

  const renderResult = await callBot<{ messageId: string; recreated: boolean }>({
    path: `/internal/panels/${existing.panel.id}/render`,
    method: 'POST',
    body: {},
  });

  revalidatePath(`/g/${args.guildId}/panels/${existing.panel.id}`);

  if (isErr(renderResult)) {
    return ok({
      value: { typeId: existing.id, panelId: existing.panel.id },
      discordSyncFailed: true,
      discordSyncMessage: renderResult.error.message,
    });
  }
  return ok({
    value: { typeId: existing.id, panelId: existing.panel.id },
    discordSyncFailed: false,
  });
}

interface RemoveTypeArgs {
  readonly guildId: string;
  readonly typeId: string;
}

export async function removeTicketType(
  args: RemoveTypeArgs,
): Promise<TypeActionResult<{ typeId: string; panelId: string }>> {
  const auth = await authorizeGuild(args.guildId);
  if (isErr(auth)) return err(auth.error);

  const existing = await dbDrizzle.query.panelTicketType.findFirst({
    where: eq(schema.panelTicketType.id, args.typeId),
    with: { panel: { columns: { guildId: true, id: true } } },
  });
  if (existing === undefined || existing.panel.guildId !== args.guildId) {
    return err({
      code: 'NOT_FOUND',
      message: `Ticket type ${args.typeId} not found in this guild`,
    });
  }

  // FK is RESTRICT — block removal while any Ticket points at this type.
  // Same copy as the slash command for consistency with bot behavior.
  const [counted] = await dbDrizzle
    .select({ value: count() })
    .from(schema.ticket)
    .where(eq(schema.ticket.panelTypeId, args.typeId));
  const ticketCount = counted?.value ?? 0;
  if (ticketCount > 0) {
    return err({
      code: 'CONFLICT',
      message: `Cannot remove ticket type '${existing.name}': ${String(ticketCount)} ticket(s) reference it. Delete those tickets first.`,
    });
  }

  await dbDrizzle.delete(schema.panelTicketType).where(eq(schema.panelTicketType.id, args.typeId));

  const renderResult = await callBot<{ messageId: string; recreated: boolean }>({
    path: `/internal/panels/${existing.panel.id}/render`,
    method: 'POST',
    body: {},
  });

  revalidatePath(`/g/${args.guildId}/panels/${existing.panel.id}`);

  if (isErr(renderResult)) {
    return ok({
      value: { typeId: existing.id, panelId: existing.panel.id },
      discordSyncFailed: true,
      discordSyncMessage: renderResult.error.message,
    });
  }
  return ok({
    value: { typeId: existing.id, panelId: existing.panel.id },
    discordSyncFailed: false,
  });
}
