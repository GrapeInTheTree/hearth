import {
  and,
  asc,
  count,
  type DbDrizzle,
  eq,
  type Panel,
  type PanelTicketType,
  schema,
} from '@hearth/database';
import { ConflictError, err, NotFoundError, ok, type Result } from '@hearth/shared';
import type { ValidationError } from '@hearth/shared';

import type { Branding } from './branding.js';
import { tickets as i18nTickets } from './i18n/index.js';
import { buildPanelComponents } from './lib/panelBuilder.js';
import type { DiscordGateway, PanelMessagePayload } from './ports/discordGateway.js';

const PLACEHOLDER_MESSAGE_ID = 'pending';

export interface UpsertPanelInput {
  readonly guildId: string;
  readonly channelId: string;
  /** Operator-supplied embed title; falls back to i18n default. */
  readonly embedTitle?: string;
  /** Operator-supplied embed description; falls back to i18n default. */
  readonly embedDescription?: string;
}

export interface UpsertPanelResult {
  readonly panel: Panel;
  readonly messageId: string;
  readonly created: boolean;
}

export interface AddTicketTypeInput {
  readonly panelId: string;
  /** Stable lookup key (operator-chosen, e.g., "question", "business-offer"). */
  readonly name: string;
  readonly label: string;
  /** Empty string = no emoji on the button. */
  readonly emoji: string;
  readonly buttonStyle?: 'primary' | 'secondary' | 'success' | 'danger';
  readonly buttonOrder?: number;
  readonly activeCategoryId: string;
  readonly supportRoleIds: readonly string[];
  readonly pingRoleIds: readonly string[];
  readonly perUserLimit: number | null;
  /** Optional override; null/undefined falls back to i18nTickets.welcome.default. */
  readonly welcomeMessage?: string;
}

export interface EditTicketTypeInput {
  readonly panelId: string;
  /** Lookup key (current name). For renaming, use removeTicketType + addTicketType. */
  readonly name: string;
  readonly label?: string;
  readonly emoji?: string;
  readonly buttonStyle?: 'primary' | 'secondary' | 'success' | 'danger';
  readonly buttonOrder?: number;
  readonly activeCategoryId?: string;
  readonly supportRoleIds?: readonly string[];
  readonly pingRoleIds?: readonly string[];
  readonly perUserLimit?: number | null;
  readonly welcomeMessage?: string | null;
}

type PanelWithTypes = Panel & { ticketTypes: PanelTicketType[] };

/**
 * Panel = a public message with N "Open ticket" buttons. Operators add
 * ticket types via /panel ticket-type add; each addition / edit / removal
 * triggers a Discord-side re-render so the panel message stays in sync
 * with the database.
 *
 * Order of operations on upsert / add: persist DB row first, then send
 * Discord message — so the button's customId can carry stable IDs. A
 * Discord-side send failure leaves a Panel row with messageId='pending'
 * which a retry of /panel create cleans up.
 */
export class PanelService {
  public constructor(
    private readonly db: DbDrizzle,
    private readonly gateway: DiscordGateway,
    private readonly branding: Branding,
  ) {}

  // ─────────────────────────────── panel ───────────────────────────────

  public async upsertPanel(
    input: UpsertPanelInput,
  ): Promise<Result<UpsertPanelResult, ValidationError>> {
    const existing = await this.db.query.panel.findFirst({
      where: and(
        eq(schema.panel.guildId, input.guildId),
        eq(schema.panel.channelId, input.channelId),
      ),
      with: { ticketTypes: true },
    });

    const embedTitle = input.embedTitle ?? i18nTickets.panel.defaultEmbedTitle;
    const embedDescription = input.embedDescription ?? i18nTickets.panel.defaultEmbedDescription;

    if (existing === undefined) {
      // Create row (no types yet) so any subsequent /panel ticket-type add
      // can reference panel.id. The 'pending' messageId is overwritten
      // below once Discord accepts the message.
      const [created] = await this.db
        .insert(schema.panel)
        .values({
          guildId: input.guildId,
          channelId: input.channelId,
          messageId: PLACEHOLDER_MESSAGE_ID,
          embedTitle,
          embedDescription,
        })
        .returning();
      if (created === undefined) {
        throw new Error('Failed to insert Panel row');
      }
      const payload = this.buildPanelPayload(embedTitle, embedDescription, []);
      const { messageId } = await this.gateway.sendPanelMessage(input.channelId, payload);
      const [panel] = await this.db
        .update(schema.panel)
        .set({ messageId })
        .where(eq(schema.panel.id, created.id))
        .returning();
      if (panel === undefined) {
        throw new Error('Failed to update Panel.messageId');
      }
      return ok({ panel, messageId, created: true });
    }

    // Re-running /panel create on the same channel: edit the live message
    // in place. If Discord 404s (message deleted out-of-band), fall through
    // to send a fresh one and overwrite messageId.
    const payload = this.buildPanelPayload(embedTitle, embedDescription, existing.ticketTypes);
    if (existing.messageId !== PLACEHOLDER_MESSAGE_ID) {
      try {
        await this.gateway.editPanelMessage(existing.channelId, existing.messageId, payload);
        const [updated] = await this.db
          .update(schema.panel)
          .set({ embedTitle, embedDescription })
          .where(eq(schema.panel.id, existing.id))
          .returning();
        if (updated === undefined) {
          throw new Error('Failed to update Panel embed');
        }
        return ok({ panel: updated, messageId: existing.messageId, created: false });
      } catch {
        // Stale messageId — fall through.
      }
    }

    const { messageId } = await this.gateway.sendPanelMessage(input.channelId, payload);
    const [updated] = await this.db
      .update(schema.panel)
      .set({ messageId, embedTitle, embedDescription })
      .where(eq(schema.panel.id, existing.id))
      .returning();
    if (updated === undefined) {
      throw new Error('Failed to update Panel after re-render');
    }
    return ok({ panel: updated, messageId, created: false });
  }

  public async listPanels(guildId: string): Promise<Panel[]> {
    return await this.db
      .select()
      .from(schema.panel)
      .where(eq(schema.panel.guildId, guildId))
      .orderBy(asc(schema.panel.createdAt));
  }

  /**
   * Re-render the panel's Discord message from the current DB state. Idempotent.
   * Used by the dashboard's internal-API hook after CRUD-style mutations the
   * dashboard performs directly against the DB. Returns the (possibly new)
   * messageId and whether the message was recreated (true when the existing
   * message id was stale or absent).
   */
  public async renderPanel(
    panelId: string,
  ): Promise<Result<{ messageId: string; recreated: boolean }, NotFoundError>> {
    const panel = await this.db.query.panel.findFirst({
      where: eq(schema.panel.id, panelId),
      with: { ticketTypes: true },
    });
    if (panel === undefined) return err(new NotFoundError(`Panel ${panelId} not found`));
    const result = await this.rerenderPanel(panel);
    return ok(result);
  }

  /**
   * Hard-delete a panel: remove the Discord message (best-effort) and the DB
   * row. Cascades to PanelTicketType via the FK. Tickets reference the panel
   * with FK RESTRICT — caller must delete tickets first or this returns the
   * Postgres FK violation (23503).
   */
  public async deletePanel(panelId: string): Promise<Result<{ panelId: string }, NotFoundError>> {
    const [panel] = await this.db
      .select()
      .from(schema.panel)
      .where(eq(schema.panel.id, panelId))
      .limit(1);
    if (panel === undefined) return err(new NotFoundError(`Panel ${panelId} not found`));
    if (panel.messageId !== PLACEHOLDER_MESSAGE_ID) {
      // Best-effort — message may already be gone, that's fine.
      await this.gateway
        .editPanelMessage(panel.channelId, panel.messageId, {
          content: undefined,
          embeds: [],
          components: [],
        })
        .catch(() => undefined);
    }
    await this.db.delete(schema.panel).where(eq(schema.panel.id, panelId));
    return ok({ panelId });
  }

  public async getPanelTypeForOpen(
    panelId: string,
    typeId: string,
  ): Promise<Result<{ panel: Panel; type: PanelTicketType }, NotFoundError>> {
    const panel = await this.db.query.panel.findFirst({
      where: eq(schema.panel.id, panelId),
      with: { ticketTypes: true },
    });
    if (panel === undefined) return err(new NotFoundError(`Panel ${panelId} not found`));
    const type = panel.ticketTypes.find((t) => t.id === typeId);
    if (type === undefined) {
      return err(new NotFoundError(`PanelTicketType ${typeId} not found on panel ${panelId}`));
    }
    return ok({ panel, type });
  }

  // ─────────────────────────── ticket types ───────────────────────────

  public async addTicketType(
    input: AddTicketTypeInput,
  ): Promise<Result<PanelTicketType, ConflictError | NotFoundError>> {
    const panel = await this.db.query.panel.findFirst({
      where: eq(schema.panel.id, input.panelId),
      with: { ticketTypes: true },
    });
    if (panel === undefined) return err(new NotFoundError(`Panel ${input.panelId} not found`));
    if (panel.ticketTypes.some((t) => t.name === input.name)) {
      return err(new ConflictError(`Ticket type '${input.name}' already exists on this panel`));
    }

    const [created] = await this.db
      .insert(schema.panelTicketType)
      .values({
        panelId: input.panelId,
        name: input.name,
        buttonLabel: input.label,
        emoji: input.emoji,
        buttonStyle: input.buttonStyle ?? 'success',
        buttonOrder: input.buttonOrder ?? panel.ticketTypes.length,
        activeCategoryId: input.activeCategoryId,
        supportRoleIds: [...input.supportRoleIds],
        pingRoleIds: [...input.pingRoleIds],
        perUserLimit: input.perUserLimit,
        welcomeMessage: input.welcomeMessage ?? null,
      })
      .returning();
    if (created === undefined) {
      throw new Error('Failed to insert PanelTicketType');
    }

    await this.rerenderPanel(panel);
    return ok(created);
  }

  public async editTicketType(
    input: EditTicketTypeInput,
  ): Promise<Result<PanelTicketType, NotFoundError>> {
    const panel = await this.db.query.panel.findFirst({
      where: eq(schema.panel.id, input.panelId),
      with: { ticketTypes: true },
    });
    if (panel === undefined) return err(new NotFoundError(`Panel ${input.panelId} not found`));
    const existing = panel.ticketTypes.find((t) => t.name === input.name);
    if (existing === undefined) {
      return err(new NotFoundError(`Ticket type '${input.name}' not found on this panel`));
    }

    // Build the SET clause incrementally so unchanged columns aren't touched.
    const updates: Partial<typeof schema.panelTicketType.$inferInsert> = {};
    if (input.label !== undefined) updates.buttonLabel = input.label;
    if (input.emoji !== undefined) updates.emoji = input.emoji;
    if (input.buttonStyle !== undefined) updates.buttonStyle = input.buttonStyle;
    if (input.buttonOrder !== undefined) updates.buttonOrder = input.buttonOrder;
    if (input.activeCategoryId !== undefined) updates.activeCategoryId = input.activeCategoryId;
    if (input.supportRoleIds !== undefined) updates.supportRoleIds = [...input.supportRoleIds];
    if (input.pingRoleIds !== undefined) updates.pingRoleIds = [...input.pingRoleIds];
    if (input.perUserLimit !== undefined) updates.perUserLimit = input.perUserLimit;
    if (input.welcomeMessage !== undefined) updates.welcomeMessage = input.welcomeMessage;

    if (Object.keys(updates).length === 0) {
      // No-op edit; return the existing row so callers don't need to branch.
      return ok(existing);
    }

    const [updated] = await this.db
      .update(schema.panelTicketType)
      .set(updates)
      .where(eq(schema.panelTicketType.id, existing.id))
      .returning();
    if (updated === undefined) {
      return err(new NotFoundError(`PanelTicketType ${existing.id} disappeared mid-update`));
    }

    await this.rerenderPanel(panel);
    return ok(updated);
  }

  public async removeTicketType(
    panelId: string,
    name: string,
  ): Promise<Result<{ removedId: string }, ConflictError | NotFoundError>> {
    const panel = await this.db.query.panel.findFirst({
      where: eq(schema.panel.id, panelId),
      with: { ticketTypes: true },
    });
    if (panel === undefined) return err(new NotFoundError(`Panel ${panelId} not found`));
    const existing = panel.ticketTypes.find((t) => t.name === name);
    if (existing === undefined) {
      return err(new NotFoundError(`Ticket type '${name}' not found on this panel`));
    }

    // FK is RESTRICT — block removal while any Ticket points at this type.
    // Counts both archived ('closed') tickets and live ones; those rows are
    // the audit trail. Operator must hard-delete remaining tickets first.
    const [counted] = await this.db
      .select({ value: count() })
      .from(schema.ticket)
      .where(eq(schema.ticket.panelTypeId, existing.id));
    const ticketCount = counted?.value ?? 0;
    if (ticketCount > 0) {
      return err(
        new ConflictError(
          `Cannot remove ticket type '${name}': ${String(ticketCount)} ticket(s) reference it. Delete those tickets first.`,
        ),
      );
    }

    await this.db.delete(schema.panelTicketType).where(eq(schema.panelTicketType.id, existing.id));
    await this.rerenderPanel(panel);
    return ok({ removedId: existing.id });
  }

  // ─────────────────────────── private ───────────────────────────

  private async rerenderPanel(
    panel: PanelWithTypes,
  ): Promise<{ messageId: string; recreated: boolean }> {
    // Re-fetch types so the rendered set reflects the just-applied mutation.
    const types = await this.db
      .select()
      .from(schema.panelTicketType)
      .where(eq(schema.panelTicketType.panelId, panel.id));
    const payload = this.buildPanelPayload(panel.embedTitle, panel.embedDescription, types);
    if (panel.messageId === PLACEHOLDER_MESSAGE_ID) {
      // Panel was created without a successful Discord send earlier.
      // Send a fresh message now that we have authoritative state.
      const { messageId } = await this.gateway.sendPanelMessage(panel.channelId, payload);
      await this.db.update(schema.panel).set({ messageId }).where(eq(schema.panel.id, panel.id));
      return { messageId, recreated: true };
    }
    try {
      await this.gateway.editPanelMessage(panel.channelId, panel.messageId, payload);
      return { messageId: panel.messageId, recreated: false };
    } catch {
      // Live message gone — recreate.
      const { messageId } = await this.gateway.sendPanelMessage(panel.channelId, payload);
      await this.db.update(schema.panel).set({ messageId }).where(eq(schema.panel.id, panel.id));
      return { messageId, recreated: true };
    }
  }

  private buildPanelPayload(
    embedTitle: string,
    embedDescription: string,
    types: readonly PanelTicketType[],
  ): PanelMessagePayload {
    return {
      content: undefined,
      embeds: [
        {
          title: embedTitle,
          description: embedDescription,
          color: this.branding.color,
        },
      ],
      components: buildPanelComponents(types),
    };
  }
}
