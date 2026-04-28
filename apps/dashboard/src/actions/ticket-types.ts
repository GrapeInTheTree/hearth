'use server';

import { db } from '@hearth/database';
import {
  ConflictError,
  type DiscordApiError,
  NotFoundError,
  type PermissionError,
  type Result,
  type ValidationError,
  ValidationError as ValidationErrorClass,
  err,
  isErr,
  ok,
} from '@hearth/shared';
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
// Constraint checks duplicated with tickets-core.PanelService:
//  - panel must exist (otherwise NotFoundError)
//  - type name must be unique within panel (ConflictError)
//  - removal blocked when any tickets reference the type (ConflictError)
// PR-5.4 tests cover these to keep the duplication honest.

export type TypeActionResult<T> = Result<
  { value: T; discordSyncFailed: boolean; discordSyncMessage?: string },
  PermissionError | ValidationError | NotFoundError | ConflictError | DiscordApiError
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
    return err(new ValidationErrorClass(parsed.error.message));
  }

  const panel = await db.panel.findUnique({
    where: { id: parsed.data.panelId },
    include: { ticketTypes: { select: { name: true } } },
  });
  if (panel === null || panel.guildId !== args.guildId) {
    return err(new NotFoundError(`Panel ${parsed.data.panelId} not found in this guild`));
  }
  if (panel.ticketTypes.some((t) => t.name === parsed.data.name)) {
    return err(new ConflictError(`Ticket type '${parsed.data.name}' already exists on this panel`));
  }

  const created = await db.panelTicketType.create({
    data: {
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
    },
  });

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

  const existing = await db.panelTicketType.findUnique({
    where: { id: args.typeId },
    include: { panel: { select: { guildId: true, id: true } } },
  });
  if (existing === null || existing.panel.guildId !== args.guildId) {
    return err(new NotFoundError(`Ticket type ${args.typeId} not found in this guild`));
  }

  await db.panelTicketType.update({
    where: { id: args.typeId },
    data: {
      ...(args.fields.label !== undefined ? { buttonLabel: args.fields.label } : {}),
      ...(args.fields.emoji !== undefined ? { emoji: args.fields.emoji } : {}),
      ...(args.fields.buttonStyle !== undefined ? { buttonStyle: args.fields.buttonStyle } : {}),
      ...(args.fields.buttonOrder !== undefined ? { buttonOrder: args.fields.buttonOrder } : {}),
      ...(args.fields.activeCategoryId !== undefined
        ? { activeCategoryId: args.fields.activeCategoryId }
        : {}),
      ...(args.fields.supportRoleIds !== undefined
        ? { supportRoleIds: [...args.fields.supportRoleIds] }
        : {}),
      ...(args.fields.pingRoleIds !== undefined
        ? { pingRoleIds: [...args.fields.pingRoleIds] }
        : {}),
      ...(args.fields.perUserLimit !== undefined ? { perUserLimit: args.fields.perUserLimit } : {}),
      ...(args.fields.welcomeMessage !== undefined
        ? { welcomeMessage: args.fields.welcomeMessage }
        : {}),
    },
  });

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

  const existing = await db.panelTicketType.findUnique({
    where: { id: args.typeId },
    include: { panel: { select: { guildId: true, id: true } } },
  });
  if (existing === null || existing.panel.guildId !== args.guildId) {
    return err(new NotFoundError(`Ticket type ${args.typeId} not found in this guild`));
  }

  // FK is RESTRICT — block removal while any Ticket points at this type.
  // Same copy as the slash command for consistency with bot behavior.
  const ticketCount = await db.ticket.count({ where: { panelTypeId: args.typeId } });
  if (ticketCount > 0) {
    return err(
      new ConflictError(
        `Cannot remove ticket type '${existing.name}': ${String(ticketCount)} ticket(s) reference it. Delete those tickets first.`,
      ),
    );
  }

  await db.panelTicketType.delete({ where: { id: args.typeId } });

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
