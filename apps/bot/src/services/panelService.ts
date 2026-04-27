import { type DbClient, type Panel, type PanelTicketType } from '@discord-bot/database';
import type { ValidationError } from '@discord-bot/shared';
import { err, NotFoundError, ok, type Result } from '@discord-bot/shared';

import type { Branding } from '../config/branding.js';
import { format, i18n } from '../i18n/index.js';
import { buildPanelComponents } from '../lib/panelBuilder.js';

import type { DiscordGateway, PanelMessagePayload } from './ports/discordGateway.js';

export type PanelType = 'support' | 'offer';

const PLACEHOLDER_MESSAGE_ID = 'pending';

export interface UpsertPanelInput {
  readonly guildId: string;
  readonly channelId: string;
  readonly type: PanelType;
  readonly activeCategoryId: string;
  readonly supportRoleIds: readonly string[];
  readonly pingRoleIds: readonly string[];
  readonly perUserLimit: number;
  /** Optional welcome-message override; null falls back to i18n default. */
  readonly welcomeMessageOverride?: string;
  /** For cross-ref in the support panel description. */
  readonly otherPanelChannelId?: string;
}

export interface UpsertPanelResult {
  readonly panel: Panel;
  readonly ticketType: PanelTicketType;
  readonly messageId: string;
  readonly created: boolean;
}

/**
 * Panel = a public message with an "Open ticket" button. One panel per
 * channel per type (Fannie pattern). Idempotent: re-running upsertPanel
 * with the same (guildId, channelId) edits the existing message instead
 * of creating duplicates.
 *
 * Order matters: we materialize Panel + PanelTicketType rows BEFORE sending
 * the Discord message because the button's customId encodes both IDs. The
 * tradeoff is that a Discord-side send failure leaves a Panel row with
 * messageId='pending' which a retry of /panel create cleans up.
 */
export class PanelService {
  public constructor(
    private readonly db: DbClient,
    private readonly gateway: DiscordGateway,
    private readonly branding: Branding,
  ) {}

  public async upsertPanel(
    input: UpsertPanelInput,
  ): Promise<Result<UpsertPanelResult, ValidationError>> {
    const existing = await this.db.panel.findFirst({
      where: { guildId: input.guildId, channelId: input.channelId },
      include: { ticketTypes: true },
    });

    // Materialize Panel + TicketType so we know the IDs the button needs.
    const panel =
      existing ??
      (await this.db.panel.create({
        data: {
          guildId: input.guildId,
          channelId: input.channelId,
          messageId: PLACEHOLDER_MESSAGE_ID,
          embedTitle: this.embedTitle(input.type),
          embedDescription: this.embedDescription(input),
        },
      }));
    const ticketType = await this.upsertTicketType(panel.id, input);

    const payload = this.buildPanelPayload(input, panel.id, ticketType);

    if (existing !== null && existing.messageId !== PLACEHOLDER_MESSAGE_ID) {
      // Try to edit the live message first. If Discord 404s (message was
      // deleted out-of-band), fall through to send a fresh one.
      try {
        await this.gateway.editPanelMessage(existing.channelId, existing.messageId, payload);
        await this.db.panel.update({
          where: { id: panel.id },
          data: {
            embedTitle: this.embedTitle(input.type),
            embedDescription: this.embedDescription(input),
          },
        });
        return ok({ panel, ticketType, messageId: existing.messageId, created: false });
      } catch {
        // Stale messageId — fall through to send + replace.
      }
    }

    const { messageId } = await this.gateway.sendPanelMessage(input.channelId, payload);
    const updated = await this.db.panel.update({
      where: { id: panel.id },
      data: {
        messageId,
        embedTitle: this.embedTitle(input.type),
        embedDescription: this.embedDescription(input),
      },
    });

    return ok({
      panel: updated,
      ticketType,
      messageId,
      created: existing === null,
    });
  }

  public async getPanelTypeForOpen(
    panelId: string,
    typeId: string,
  ): Promise<Result<{ panel: Panel; type: PanelTicketType }, NotFoundError>> {
    const panel = await this.db.panel.findUnique({
      where: { id: panelId },
      include: { ticketTypes: true },
    });
    if (panel === null) return err(new NotFoundError(`Panel ${panelId} not found`));
    const type = panel.ticketTypes.find((t) => t.id === typeId);
    if (type === undefined) {
      return err(new NotFoundError(`PanelTicketType ${typeId} not found on panel ${panelId}`));
    }
    return ok({ panel, type });
  }

  public async listPanels(guildId: string): Promise<Panel[]> {
    return await this.db.panel.findMany({ where: { guildId }, orderBy: { createdAt: 'asc' } });
  }

  // ─────────────────────────── private ───────────────────────────

  private async upsertTicketType(
    panelId: string,
    input: UpsertPanelInput,
  ): Promise<PanelTicketType> {
    const existingType = await this.db.panelTicketType.findFirst({
      where: { panelId, name: input.type },
    });
    const data = {
      panelId,
      name: input.type,
      emoji: input.type === 'support' ? '📨' : '🤝',
      buttonStyle: 'success' as const,
      buttonLabel: 'Open ticket',
      buttonOrder: 0,
      activeCategoryId: input.activeCategoryId,
      supportRoleIds: [...input.supportRoleIds],
      pingRoleIds: [...input.pingRoleIds],
      perUserLimit: input.perUserLimit,
      welcomeMessage: input.welcomeMessageOverride ?? null,
    };
    if (existingType === null) {
      return await this.db.panelTicketType.create({ data });
    }
    return await this.db.panelTicketType.update({ where: { id: existingType.id }, data });
  }

  private buildPanelPayload(
    input: UpsertPanelInput,
    panelId: string,
    ticketType: PanelTicketType,
  ): PanelMessagePayload {
    return {
      content: undefined,
      embeds: [
        {
          title: this.embedTitle(input.type),
          description: this.embedDescription(input),
          color: this.branding.color,
        },
      ],
      components: buildPanelComponents({
        panelId,
        typeId: ticketType.id,
        emoji: ticketType.emoji,
        label: ticketType.buttonLabel ?? 'Open ticket',
      }),
    };
  }

  private embedTitle(type: PanelType): string {
    return type === 'support' ? 'Support' : 'Offer';
  }

  private embedDescription(input: UpsertPanelInput): string {
    const base =
      input.type === 'support'
        ? i18n.tickets.panel.embedDescriptionSupport
        : i18n.tickets.panel.embedDescriptionOffer;
    if (input.otherPanelChannelId === undefined) return base;
    return format(base, { offerChannel: `<#${input.otherPanelChannelId}>` });
  }
}
