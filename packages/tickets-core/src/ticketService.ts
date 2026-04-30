import {
  and,
  asc,
  type DbDrizzle,
  eq,
  inArray,
  isUniqueViolation,
  schema,
  type Ticket,
  TicketStatus,
} from '@hearth/database';
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
    private readonly db: DbDrizzle,
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
    // ('open', 'claimed')` — concurrent INSERTs collide on 23505 and we
    // map that to ConflictError + clean up the orphan channel. PR-7
    // replaces this optimistic path with `withAdvisoryLock` so the orphan
    // channel rollback path is eliminated.
    const [existing] = await this.db
      .select({ id: schema.ticket.id })
      .from(schema.ticket)
      .where(
        and(
          eq(schema.ticket.guildId, input.guildId),
          eq(schema.ticket.openerId, input.openerId),
          eq(schema.ticket.panelTypeId, type.id),
          inArray(schema.ticket.status, [TicketStatus.open, TicketStatus.claimed]),
        ),
      )
      .limit(1);
    if (existing !== undefined) {
      return err(new ConflictError(i18nTickets.errors.alreadyOpen));
    }

    // Reserve a ticket number outside any transaction. The counter is
    // monotonic (atomic increment in GuildConfigService); a number can
    // burn unused if subsequent steps fail, which is acceptable.
    const number = await this.guildConfig.incrementTicketCounter(this.db, input.guildId);
    const channelName = formatChannelName(number, input.openerUsername, input.openerId);

    // Create the Discord channel before the DB write — the same shape as
    // the post-Prisma-7-P2028 workaround. PR-7 reorders this so the DB
    // row is reserved first inside an advisory-locked tx, then the channel
    // is created outside the lock; that path eliminates the orphan-channel
    // rollback below in favor of an orphan-row delete (1ms vs 1-5s).
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

    // Two separate writes — no interactive transaction. The Ticket INSERT
    // carries the critical invariants (channel link, partial unique
    // dedupe); the TicketEvent INSERT is metadata that, if it fails,
    // leaves the ticket usable but missing its 'opened' marker —
    // recoverable in a follow-up audit, and the channelDelete listener
    // / lifecycle events don't depend on it.
    let ticket: Ticket;
    try {
      const [inserted] = await this.db
        .insert(schema.ticket)
        .values({
          guildId: input.guildId,
          panelId: input.panelId,
          panelTypeId: type.id,
          channelId: createdChannelId,
          number,
          openerId: input.openerId,
          status: TicketStatus.open,
        })
        .returning();
      if (inserted === undefined) {
        throw new Error('Ticket insert returned no row');
      }
      ticket = inserted;
    } catch (e) {
      await this.gateway
        .deleteChannel(createdChannelId, 'ticket open rolled back')
        .catch(() => undefined);
      if (isUniqueViolation(e)) {
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

    // Best-effort 'opened' event. Failure is logged but doesn't roll
    // back the ticket — the event is audit-trail metadata, not a
    // critical invariant. A future audit job can backfill from the
    // ticket's openedAt + openerId if needed.
    try {
      await this.db.insert(schema.ticketEvent).values({
        ticketId: ticket.id,
        type: 'opened',
        actorId: input.openerId,
        metadata: { channelId: createdChannelId, number },
      });
    } catch (eventErr) {
      // eslint-disable-next-line no-console
      console.warn('[openTicket] failed to create opened event', eventErr);
    }

    // Send welcome message OUTSIDE any transaction — Discord call is slow.
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
      const [updated] = await this.db
        .update(schema.ticket)
        .set({ welcomeMessageId: messageId })
        .where(eq(schema.ticket.id, ticket.id))
        .returning();
      return ok(updated ?? ticket);
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
    const ticket = await this.findTicket(input.ticketId);
    if (ticket === null) {
      return err(new NotFoundError(`Ticket ${input.ticketId} not found`));
    }

    if (!isSupportStaff(input.actorRoleIds, await this.supportRoleIds(ticket.panelTypeId))) {
      return err(new PermissionError(i18nTickets.errors.notSupportStaff));
    }
    if (ticket.status !== TicketStatus.open) {
      return err(new ConflictError(i18nTickets.errors.alreadyClaimed));
    }

    // Optimistic: only update if status is still 'open'. Empty `.returning()`
    // → racer beat us to it.
    const claimed = await this.db
      .update(schema.ticket)
      .set({
        status: TicketStatus.claimed,
        claimedById: input.actorId,
        claimedAt: new Date(),
      })
      .where(and(eq(schema.ticket.id, input.ticketId), eq(schema.ticket.status, TicketStatus.open)))
      .returning();
    if (claimed.length === 0) {
      return err(new ConflictError(i18nTickets.errors.alreadyClaimed));
    }
    await this.db.insert(schema.ticketEvent).values({
      ticketId: input.ticketId,
      type: 'claimed',
      actorId: input.actorId,
    });

    const refreshed = await this.findTicketOrThrow(input.ticketId);
    await this.applyButtonStateChange(refreshed, 'claimed');
    await this.postSystemMessage(
      refreshed.channelId,
      format(i18nTickets.claimMessage, { actor_mention: `<@${input.actorId}>` }),
    );
    return ok(refreshed);
  }

  // ─────────────────────────────── close ───────────────────────────────

  public async closeTicket(input: ActorInput): Promise<Result<Ticket, LifecycleError>> {
    const ticket = await this.findTicket(input.ticketId);
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

    const closed = await this.db
      .update(schema.ticket)
      .set({
        status: TicketStatus.closed,
        closedById: input.actorId,
        closedAt: new Date(),
      })
      .where(
        and(
          eq(schema.ticket.id, input.ticketId),
          inArray(schema.ticket.status, [TicketStatus.open, TicketStatus.claimed]),
        ),
      )
      .returning();
    if (closed.length === 0) {
      return err(new ConflictError(i18nTickets.errors.alreadyClosed));
    }
    await this.db.insert(schema.ticketEvent).values({
      ticketId: input.ticketId,
      type: 'closed',
      actorId: input.actorId,
    });

    const refreshed = await this.findTicketOrThrow(input.ticketId);
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
    const ticket = await this.findTicket(input.ticketId);
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
    const reopened = await this.db
      .update(schema.ticket)
      .set({ status: targetStatus, closedAt: null, closedById: null })
      .where(
        and(eq(schema.ticket.id, input.ticketId), eq(schema.ticket.status, TicketStatus.closed)),
      )
      .returning();
    if (reopened.length === 0) {
      return err(new ConflictError(i18nTickets.errors.notClosed));
    }
    await this.db.insert(schema.ticketEvent).values({
      ticketId: input.ticketId,
      type: 'reopened',
      actorId: input.actorId,
    });

    const refreshed = await this.findTicketOrThrow(input.ticketId);
    const [type] = await this.db
      .select()
      .from(schema.panelTicketType)
      .where(eq(schema.panelTicketType.id, refreshed.panelTypeId))
      .limit(1);
    if (type !== undefined) {
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
    const ticketWithEvents = await this.db.query.ticket.findFirst({
      where: eq(schema.ticket.id, input.ticketId),
      with: { events: { orderBy: asc(schema.ticketEvent.createdAt) } },
    });
    if (ticketWithEvents === undefined) {
      return err(new NotFoundError(`Ticket ${input.ticketId} not found`));
    }

    // Write the audit event BEFORE cascade so the modlog metadata captures
    // a snapshot. The Ticket.delete below will cascade-delete all TicketEvent
    // rows including this one — that's intentional, the modlog embed is the
    // surviving audit trail.
    await this.db.insert(schema.ticketEvent).values({
      ticketId: input.ticketId,
      type: 'deleted',
      actorId: input.actorId,
      metadata: {
        number: ticketWithEvents.number,
        openerId: ticketWithEvents.openerId,
        claimedById: ticketWithEvents.claimedById,
        openedAt: ticketWithEvents.openedAt.toISOString(),
        closedAt: ticketWithEvents.closedAt?.toISOString() ?? null,
        eventCount: ticketWithEvents.events.length + 1,
      },
    });

    const config = await this.guildConfig.getOrCreate(ticketWithEvents.guildId);
    if (config.alertChannelId !== null) {
      const embed: ModlogEmbed = {
        title: 'Ticket deleted',
        color: this.branding.color,
        fields: [
          { name: 'Number', value: `#${String(ticketWithEvents.number)}`, inline: true },
          { name: 'Opener', value: `<@${ticketWithEvents.openerId}>`, inline: true },
          {
            name: 'Claimed by',
            value:
              ticketWithEvents.claimedById !== null ? `<@${ticketWithEvents.claimedById}>` : '—',
            inline: true,
          },
          { name: 'Deleted by', value: `<@${input.actorId}>`, inline: true },
          { name: 'Events', value: String(ticketWithEvents.events.length + 1), inline: true },
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
    this.markRecentlyDeleted(ticketWithEvents.channelId);
    try {
      await this.gateway.deleteChannel(
        ticketWithEvents.channelId,
        `Ticket deleted by ${input.actorId}`,
      );
    } catch (e) {
      if (e instanceof DiscordApiError) return err(e);
      throw e;
    }
    await this.db.delete(schema.ticket).where(eq(schema.ticket.id, input.ticketId));
    return ok({ ticketId: input.ticketId });
  }

  // ─────────────────── orphan reconciliation ───────────────────

  public async markChannelOrphaned(channelId: string): Promise<void> {
    if (this.consumeRecentlyDeleted(channelId)) return;

    const [ticket] = await this.db
      .select()
      .from(schema.ticket)
      .where(eq(schema.ticket.channelId, channelId))
      .limit(1);
    if (ticket === undefined) return;
    if (ticket.status === TicketStatus.closed) return;

    await this.db
      .update(schema.ticket)
      .set({ status: TicketStatus.closed, closedAt: new Date() })
      .where(eq(schema.ticket.id, ticket.id));
    await this.db.insert(schema.ticketEvent).values({
      ticketId: ticket.id,
      type: 'channel-deleted-externally',
      actorId: 'system',
      metadata: { channelId },
    });
  }

  // ─────────────────────────── private ───────────────────────────

  private async findTicket(ticketId: string): Promise<Ticket | null> {
    const [row] = await this.db
      .select()
      .from(schema.ticket)
      .where(eq(schema.ticket.id, ticketId))
      .limit(1);
    return row ?? null;
  }

  private async findTicketOrThrow(ticketId: string): Promise<Ticket> {
    const ticket = await this.findTicket(ticketId);
    if (ticket === null) {
      throw new InternalError(`Ticket ${ticketId} disappeared mid-operation`);
    }
    return ticket;
  }

  private async supportRoleIds(panelTypeId: string): Promise<readonly string[]> {
    const [type] = await this.db
      .select({ supportRoleIds: schema.panelTicketType.supportRoleIds })
      .from(schema.panelTicketType)
      .where(eq(schema.panelTicketType.id, panelTypeId))
      .limit(1);
    if (type === undefined) {
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

    const [type] = await this.db
      .select()
      .from(schema.panelTicketType)
      .where(eq(schema.panelTicketType.id, ticket.panelTypeId))
      .limit(1);
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
