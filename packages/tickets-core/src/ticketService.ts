import { type DbClient, type Ticket, TicketStatus } from '@hearth/database';
import { Prisma } from '@hearth/database';
import {
  ConflictError,
  DiscordApiError,
  err,
  InternalError,
  NotFoundError,
  ok,
  PermissionError,
  type Result,
  ValidationError,
} from '@hearth/shared';

import type { Branding } from './branding.js';
import type { GuildConfigService } from './guildConfigService.js';
import { format, tickets as i18nTickets } from './i18n/index.js';
import { formatChannelName } from './lib/format.js';
import { hasManageGuild, isSupportStaff } from './lib/permissions.js';
import { buildWelcomeMessage } from './lib/welcomeBuilder.js';
import type { PanelService } from './panelService.js';
import type { DiscordGateway, ModlogEmbed } from './ports/discordGateway.js';

// Soft cap: Discord categories hold up to 50 channels. We refuse new tickets
// at 48 to leave headroom for two concurrent racers between the count and the
// create.
const CATEGORY_CHILD_SOFT_CAP = 48;

export interface OpenTicketInput {
  readonly guildId: string;
  readonly openerId: string;
  readonly openerUsername: string;
  readonly panelId: string;
  readonly typeId: string;
}

export interface ActorInput {
  readonly ticketId: string;
  readonly actorId: string;
  readonly actorRoleIds: readonly string[];
}

export interface DeleteTicketInput {
  readonly ticketId: string;
  readonly actorId: string;
  readonly actorPermissionsBits: bigint;
}

type OpenTicketError = ConflictError | NotFoundError | ValidationError | DiscordApiError;
type LifecycleError = PermissionError | ConflictError | NotFoundError | DiscordApiError;
type DeleteError = PermissionError | NotFoundError | DiscordApiError;

export class TicketService {
  /**
   * Channels we've intentionally deleted via deleteTicket. The channelDelete
   * listener checks this set to suppress orphan-reconciliation for our own
   * deletions. Entries auto-expire after 60s.
   */
  private readonly recentlyDeletedChannels = new Map<string, number>();

  public constructor(
    private readonly db: DbClient,
    private readonly gateway: DiscordGateway,
    private readonly branding: Branding,
    private readonly guildConfig: GuildConfigService,
    private readonly panel: PanelService,
  ) {}

  // ─────────────────────────────── open ───────────────────────────────

  public async openTicket(input: OpenTicketInput): Promise<Result<Ticket, OpenTicketError>> {
    // Read panel/type outside the lock — fast; failure is independent of contention.
    const panelResult = await this.panel.getPanelTypeForOpen(input.panelId, input.typeId);
    if (!panelResult.ok) return err(panelResult.error);
    const { type } = panelResult.value;

    // Soft-cap check before holding the lock so we fail fast on overflow.
    let childCount: number;
    try {
      childCount = await this.gateway.countCategoryChildren(type.activeCategoryId);
    } catch (e) {
      if (e instanceof DiscordApiError) return err(e);
      throw e;
    }
    if (childCount >= CATEGORY_CHILD_SOFT_CAP) {
      return err(new ConflictError(i18nTickets.errors.categoryFull));
    }

    // Best-effort pre-flight: cheap "already open?" check so a duplicate
    // click never even creates a Discord channel. The race between this
    // SELECT and the INSERT below is closed by the partial unique index
    // `ticket_open_dedupe (guildId, openerId, panelTypeId) WHERE status IN
    // ('open', 'claimed')` — concurrent INSERTs collide on P2002 and we
    // map that to ConflictError + clean up the orphan channel.
    const existing = await this.db.ticket.findFirst({
      where: {
        guildId: input.guildId,
        openerId: input.openerId,
        panelTypeId: type.id,
        status: { in: [TicketStatus.open, TicketStatus.claimed] },
      },
    });
    if (existing !== null) {
      return err(new ConflictError(i18nTickets.errors.alreadyOpen));
    }

    // Reserve a ticket number outside any transaction. The counter is
    // monotonic (atomic increment in GuildConfigService); a number can
    // burn unused if subsequent steps fail, which is acceptable.
    const number = await this.guildConfig.incrementTicketCounter(this.db, input.guildId);
    const channelName = formatChannelName(number, input.openerUsername, input.openerId);

    // Create the Discord channel before the DB write. Holding a Postgres
    // transaction open across a Discord REST call (1-5s p95) caused
    // Prisma 7's interactive-transaction tracking to drop the
    // transaction id and raise P2028 ("Transaction not found") under VM
    // latency conditions. Doing the slow side-effect first means the DB
    // write becomes a tiny, in-memory-fast nested create — no
    // long-lived transactions, no advisory lock needed.
    let createdChannelId: string;
    try {
      const result = await this.gateway.createTicketChannel({
        guildId: input.guildId,
        parentId: type.activeCategoryId,
        name: channelName,
        topic: `Ticket #${String(number)} • opened by <@${input.openerId}>`,
        openerId: input.openerId,
        supportRoleIds: type.supportRoleIds,
      });
      createdChannelId = result.channelId;
    } catch (e) {
      if (e instanceof DiscordApiError) return err(e);
      throw e;
    }

    // Tight transaction over just the two DB writes. No external calls
    // inside, so no timeout / transaction-tracking risk. The partial
    // unique index `ticket_open_dedupe` enforces dedupe — if a racer
    // slipped in between our SELECT above and this INSERT, Prisma
    // raises P2002 and we map it to ConflictError.
    let ticket: Ticket;
    try {
      ticket = await this.db.$transaction(async (tx) => {
        const created = await tx.ticket.create({
          data: {
            guildId: input.guildId,
            panelId: input.panelId,
            panelTypeId: type.id,
            channelId: createdChannelId,
            number,
            openerId: input.openerId,
            status: TicketStatus.open,
          },
        });
        await tx.ticketEvent.create({
          data: {
            ticketId: created.id,
            type: 'opened',
            actorId: input.openerId,
            metadata: { channelId: createdChannelId, number },
          },
        });
        return created;
      });
    } catch (e) {
      await this.gateway
        .deleteChannel(createdChannelId, 'ticket open rolled back')
        .catch(() => undefined);
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return err(new ConflictError(i18nTickets.errors.alreadyOpen, e));
      }
      if (
        e instanceof ConflictError ||
        e instanceof NotFoundError ||
        e instanceof ValidationError ||
        e instanceof DiscordApiError
      ) {
        return err(e);
      }
      throw e;
    }

    // Send welcome message OUTSIDE the lock — Discord call is slow.
    const welcomePayload = buildWelcomeMessage(
      {
        state: 'open',
        ticketId: ticket.id,
        ...(type.welcomeMessage !== null ? { bodyOverride: type.welcomeMessage } : {}),
      },
      this.branding,
    );
    try {
      const { messageId } = await this.gateway.sendWelcomeMessage({
        channelId: ticket.channelId,
        payload: welcomePayload,
        pingRoleIds: type.pingRoleIds,
        pin: true,
      });
      const updated = await this.db.ticket.update({
        where: { id: ticket.id },
        data: { welcomeMessageId: messageId },
      });
      return ok(updated);
    } catch (e) {
      // Welcome message failure is non-fatal — the channel still works,
      // a future state change will rebuild the welcome.
      if (e instanceof DiscordApiError) {
        return ok(ticket);
      }
      throw e;
    }
  }

  // ─────────────────────────────── claim ───────────────────────────────

  public async claimTicket(input: ActorInput): Promise<Result<Ticket, LifecycleError>> {
    const ticket = await this.db.ticket.findUnique({ where: { id: input.ticketId } });
    if (ticket === null) {
      return err(new NotFoundError(`Ticket ${input.ticketId} not found`));
    }

    if (!isSupportStaff(input.actorRoleIds, await this.supportRoleIds(ticket.panelTypeId))) {
      return err(new PermissionError(i18nTickets.errors.notSupportStaff));
    }
    if (ticket.status !== TicketStatus.open) {
      return err(new ConflictError(i18nTickets.errors.alreadyClaimed));
    }

    // Optimistic: only update if status is still 'open'. 0 rows → racer won.
    const result = await this.db.ticket.updateMany({
      where: { id: input.ticketId, status: TicketStatus.open },
      data: { status: TicketStatus.claimed, claimedById: input.actorId, claimedAt: new Date() },
    });
    if (result.count === 0) {
      return err(new ConflictError(i18nTickets.errors.alreadyClaimed));
    }
    await this.db.ticketEvent.create({
      data: { ticketId: input.ticketId, type: 'claimed', actorId: input.actorId },
    });

    const refreshed = await this.db.ticket.findUniqueOrThrow({ where: { id: input.ticketId } });
    await this.applyButtonStateChange(refreshed, 'claimed');
    await this.postSystemMessage(
      refreshed.channelId,
      format(i18nTickets.claimMessage, { actor_mention: `<@${input.actorId}>` }),
    );
    return ok(refreshed);
  }

  // ─────────────────────────────── close ───────────────────────────────

  public async closeTicket(input: ActorInput): Promise<Result<Ticket, LifecycleError>> {
    const ticket = await this.db.ticket.findUnique({ where: { id: input.ticketId } });
    if (ticket === null) {
      return err(new NotFoundError(`Ticket ${input.ticketId} not found`));
    }

    const isOpener = ticket.openerId === input.actorId;
    if (
      !isOpener &&
      !isSupportStaff(input.actorRoleIds, await this.supportRoleIds(ticket.panelTypeId))
    ) {
      return err(new PermissionError(i18nTickets.errors.notSupportStaff));
    }
    if (ticket.status === TicketStatus.closed) {
      return err(new ConflictError(i18nTickets.errors.alreadyClosed));
    }

    const result = await this.db.ticket.updateMany({
      where: { id: input.ticketId, status: { in: [TicketStatus.open, TicketStatus.claimed] } },
      data: { status: TicketStatus.closed, closedById: input.actorId, closedAt: new Date() },
    });
    if (result.count === 0) {
      return err(new ConflictError(i18nTickets.errors.alreadyClosed));
    }
    await this.db.ticketEvent.create({
      data: { ticketId: input.ticketId, type: 'closed', actorId: input.actorId },
    });

    const refreshed = await this.db.ticket.findUniqueOrThrow({ where: { id: input.ticketId } });
    const config = await this.guildConfig.getOrCreate(refreshed.guildId);
    if (config.archiveCategoryId !== null) {
      try {
        await this.gateway.moveChannelToCategory(refreshed.channelId, config.archiveCategoryId);
      } catch (e) {
        if (e instanceof DiscordApiError) return err(e);
        throw e;
      }
    }
    try {
      await this.gateway.setOpenerSendMessages(refreshed.channelId, refreshed.openerId, false);
    } catch (e) {
      if (e instanceof DiscordApiError) return err(e);
      throw e;
    }

    await this.applyButtonStateChange(refreshed, 'closed');
    await this.postSystemMessage(
      refreshed.channelId,
      format(i18nTickets.closeMessage, {
        closer_mention: `<@${input.actorId}>`,
        closer_emojis: '',
      }),
    );
    return ok(refreshed);
  }

  // ─────────────────────────────── reopen ───────────────────────────────

  public async reopenTicket(input: ActorInput): Promise<Result<Ticket, LifecycleError>> {
    const ticket = await this.db.ticket.findUnique({ where: { id: input.ticketId } });
    if (ticket === null) {
      return err(new NotFoundError(`Ticket ${input.ticketId} not found`));
    }
    if (!isSupportStaff(input.actorRoleIds, await this.supportRoleIds(ticket.panelTypeId))) {
      return err(new PermissionError(i18nTickets.errors.notSupportStaff));
    }
    if (ticket.status !== TicketStatus.closed) {
      return err(new ConflictError(i18nTickets.errors.notClosed));
    }

    const targetStatus = ticket.claimedById !== null ? TicketStatus.claimed : TicketStatus.open;
    const result = await this.db.ticket.updateMany({
      where: { id: input.ticketId, status: TicketStatus.closed },
      data: { status: targetStatus, closedAt: null, closedById: null },
    });
    if (result.count === 0) {
      return err(new ConflictError(i18nTickets.errors.notClosed));
    }
    await this.db.ticketEvent.create({
      data: { ticketId: input.ticketId, type: 'reopened', actorId: input.actorId },
    });

    const refreshed = await this.db.ticket.findUniqueOrThrow({ where: { id: input.ticketId } });
    const type = await this.db.panelTicketType.findUnique({ where: { id: refreshed.panelTypeId } });
    if (type !== null) {
      try {
        await this.gateway.moveChannelToCategory(refreshed.channelId, type.activeCategoryId);
      } catch (e) {
        if (e instanceof DiscordApiError) return err(e);
        throw e;
      }
    }
    try {
      await this.gateway.setOpenerSendMessages(refreshed.channelId, refreshed.openerId, true);
    } catch (e) {
      if (e instanceof DiscordApiError) return err(e);
      throw e;
    }

    await this.applyButtonStateChange(
      refreshed,
      refreshed.status === TicketStatus.claimed ? 'claimed' : 'open',
    );
    await this.postSystemMessage(
      refreshed.channelId,
      format(i18nTickets.reopenMessage, { actor_mention: `<@${input.actorId}>` }),
    );
    return ok(refreshed);
  }

  // ─────────────────────────────── delete ───────────────────────────────

  public async deleteTicket(
    input: DeleteTicketInput,
  ): Promise<Result<{ ticketId: string }, DeleteError>> {
    if (!hasManageGuild(input.actorPermissionsBits)) {
      return err(new PermissionError(i18nTickets.errors.notAdmin));
    }
    const ticket = await this.db.ticket.findUnique({
      where: { id: input.ticketId },
      include: { events: { orderBy: { createdAt: 'asc' } } },
    });
    if (ticket === null) {
      return err(new NotFoundError(`Ticket ${input.ticketId} not found`));
    }

    // Write the audit event BEFORE cascade so the modlog metadata captures
    // a snapshot. The Ticket.delete below will cascade-delete all TicketEvent
    // rows including this one — that's intentional, the modlog embed is the
    // surviving audit trail.
    await this.db.ticketEvent.create({
      data: {
        ticketId: input.ticketId,
        type: 'deleted',
        actorId: input.actorId,
        metadata: {
          number: ticket.number,
          openerId: ticket.openerId,
          claimedById: ticket.claimedById,
          openedAt: ticket.openedAt.toISOString(),
          closedAt: ticket.closedAt?.toISOString() ?? null,
          eventCount: ticket.events.length + 1,
        },
      },
    });

    const config = await this.guildConfig.getOrCreate(ticket.guildId);
    if (config.alertChannelId !== null) {
      const embed: ModlogEmbed = {
        title: 'Ticket deleted',
        color: this.branding.color,
        fields: [
          { name: 'Number', value: `#${String(ticket.number)}`, inline: true },
          { name: 'Opener', value: `<@${ticket.openerId}>`, inline: true },
          {
            name: 'Claimed by',
            value: ticket.claimedById !== null ? `<@${ticket.claimedById}>` : '—',
            inline: true,
          },
          { name: 'Deleted by', value: `<@${input.actorId}>`, inline: true },
          { name: 'Events', value: String(ticket.events.length + 1), inline: true },
        ],
        timestamp: new Date().toISOString(),
      };
      try {
        await this.gateway.postModlogSummary(config.alertChannelId, embed);
      } catch (e) {
        if (e instanceof DiscordApiError) {
          // Modlog is best-effort — log via thrown error type only, continue.
          return err(e);
        }
        throw e;
      }
    }

    // Mark this channel as a self-initiated deletion so the channelDelete
    // listener doesn't try to mark a non-existent ticket as orphaned.
    this.markRecentlyDeleted(ticket.channelId);
    try {
      await this.gateway.deleteChannel(ticket.channelId, `Ticket deleted by ${input.actorId}`);
    } catch (e) {
      if (e instanceof DiscordApiError) return err(e);
      throw e;
    }
    await this.db.ticket.delete({ where: { id: input.ticketId } });
    return ok({ ticketId: input.ticketId });
  }

  // ─────────────────── orphan reconciliation ───────────────────

  public async markChannelOrphaned(channelId: string): Promise<void> {
    if (this.consumeRecentlyDeleted(channelId)) return;

    const ticket = await this.db.ticket.findUnique({ where: { channelId } });
    if (ticket === null) return;
    if (ticket.status === TicketStatus.closed) return;

    await this.db.ticket.update({
      where: { id: ticket.id },
      data: { status: TicketStatus.closed, closedAt: new Date() },
    });
    await this.db.ticketEvent.create({
      data: {
        ticketId: ticket.id,
        type: 'channel-deleted-externally',
        actorId: 'system',
        metadata: { channelId },
      },
    });
  }

  // ─────────────────────────── private ───────────────────────────

  private async supportRoleIds(panelTypeId: string): Promise<readonly string[]> {
    const type = await this.db.panelTicketType.findUnique({ where: { id: panelTypeId } });
    if (type === null) {
      throw new InternalError(`PanelTicketType ${panelTypeId} not found`);
    }
    return type.supportRoleIds;
  }

  private async applyButtonStateChange(
    ticket: Ticket,
    state: 'open' | 'claimed' | 'closed',
  ): Promise<void> {
    if (ticket.welcomeMessageId === null) return;
    const claimedByDisplay =
      state === 'claimed' && ticket.claimedById !== null
        ? await this.gateway
            .resolveMemberDisplay(ticket.guildId, ticket.claimedById)
            .catch(() => ticket.claimedById ?? '')
        : undefined;

    const type = await this.db.panelTicketType.findUnique({ where: { id: ticket.panelTypeId } });
    const payload = buildWelcomeMessage(
      {
        state,
        ticketId: ticket.id,
        ...(type?.welcomeMessage !== null && type?.welcomeMessage !== undefined
          ? { bodyOverride: type.welcomeMessage }
          : {}),
        ...(claimedByDisplay !== undefined ? { claimedByDisplay } : {}),
      },
      this.branding,
    );

    try {
      await this.gateway.editWelcomeMessage(ticket.channelId, ticket.welcomeMessageId, payload);
    } catch {
      // Best-effort. If the message was deleted, the next interaction will
      // re-resolve from current DB state.
    }
  }

  private async postSystemMessage(channelId: string, content: string): Promise<void> {
    try {
      await this.gateway.postSystemMessage(channelId, content);
    } catch {
      // Best-effort; logged in gateway.
    }
  }

  private markRecentlyDeleted(channelId: string): void {
    this.pruneRecentlyDeleted();
    this.recentlyDeletedChannels.set(channelId, Date.now());
  }

  private consumeRecentlyDeleted(channelId: string): boolean {
    this.pruneRecentlyDeleted();
    return this.recentlyDeletedChannels.delete(channelId);
  }

  private pruneRecentlyDeleted(): void {
    const cutoff = Date.now() - 60_000;
    for (const [id, ts] of this.recentlyDeletedChannels) {
      if (ts < cutoff) this.recentlyDeletedChannels.delete(id);
    }
  }
}
