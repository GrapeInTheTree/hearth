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
import { createId } from '@paralleldrive/cuid2';

import type { Branding } from './branding.js';
import type { GuildConfigService } from './guildConfigService.js';
import { format, tickets as i18nTickets } from './i18n/index.js';
import { withAdvisoryLock } from './lib/advisoryLock.js';
import { formatChannelName } from './lib/format.js';
import { ticketOpenLockKey } from './lib/lockKeys.js';
import { hasManageGuild, isSupportStaff } from './lib/permissions.js';
import { buildWelcomeMessage } from './lib/welcomeBuilder.js';
import type { PanelService } from './panelService.js';
import type { DiscordGateway, ModlogEmbed } from './ports/discordGateway.js';

// pg_advisory_xact_lock acquisition timeout. Same-tuple contention
// (same user double-clicking the same panel type) is the only path
// this fires on; 200ms is generous since the locked critical section
// is three small INSERTs (~5ms total). Hitting the timeout means a
// concurrent racer holds the lock — caller maps to alreadyOpen
// ConflictError, identical UX to the partial-unique collision path.
const OPEN_TICKET_LOCK_TIMEOUT_MS = 200;

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
    // Read panel/type outside the lock — fast and read-only; failure is
    // independent of contention. Same path as before PR-7.
    const panelResult = await this.panel.getPanelTypeForOpen(input.panelId, input.typeId);
    if (!panelResult.ok) return err(panelResult.error);
    const { type } = panelResult.value;

    // Soft-cap check before the lock so we fail fast on category overflow
    // without ever issuing a DB write.
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

    // Reserve the ticket row inside an advisory-locked transaction. The
    // critical section is three INSERT statements; the lock serialises
    // contention on (guildId, openerId, panelTypeId) so concurrent racers
    // see a clean ConflictError instead of fighting on the partial-unique
    // index. The Discord channel-create — slow REST round-trip — runs
    // OUTSIDE the lock; pre-PR-7 it ran first and a 23505 collision had
    // to roll back the orphan channel (1-5s of REST). Now an orphan row
    // is the failure mode, and a row delete is sub-millisecond.
    //
    // The placeholder channelId 'pending:<cuid>' satisfies the column's
    // UNIQUE constraint until we patch the real id in step 4.
    const lockKey = ticketOpenLockKey(input.guildId, input.openerId, type.id);
    const placeholderChannelId = `pending:${createId()}`;
    let pending: Ticket;
    try {
      pending = await withAdvisoryLock(
        this.db,
        { key: lockKey, timeoutMs: OPEN_TICKET_LOCK_TIMEOUT_MS },
        async (tx) => {
          // Re-check existing inside the lock. Since the lock serialises
          // (guildId, openerId, panelTypeId) tuples, this read sees the
          // committed state of the previous winner and returns true if
          // they're already open or claimed.
          const [existing] = await tx
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
            throw new ConflictError(i18nTickets.errors.alreadyOpen);
          }

          // Atomic counter increment inside the same tx as the insert
          // — guarantees the (guildId, number) pair is unique even if
          // a second tx rolls back after burning a number.
          const number = await this.guildConfig.incrementTicketCounter(tx, input.guildId);

          const [inserted] = await tx
            .insert(schema.ticket)
            .values({
              guildId: input.guildId,
              panelId: input.panelId,
              panelTypeId: type.id,
              channelId: placeholderChannelId,
              number,
              openerId: input.openerId,
              status: TicketStatus.open,
            })
            .returning();
          if (inserted === undefined) {
            throw new InternalError('Ticket insert returned no row');
          }

          // 'opened' event committed in the same tx — no more
          // best-effort try/catch since transactional consistency is
          // free now that interactive transactions are reliable.
          await tx.insert(schema.ticketEvent).values({
            ticketId: inserted.id,
            type: 'opened',
            actorId: input.openerId,
            metadata: { number },
          });

          return inserted;
        },
      );
    } catch (e) {
      if (e instanceof ConflictError) return err(e);
      // The partial unique index is belt-and-suspenders for the lock —
      // if Postgres ever serves the same lock key to two waiters (it
      // shouldn't), 23505 still catches the collision.
      if (isUniqueViolation(e)) {
        return err(new ConflictError(i18nTickets.errors.alreadyOpen, e));
      }
      if (
        e instanceof NotFoundError ||
        e instanceof ValidationError ||
        e instanceof DiscordApiError
      ) {
        return err(e);
      }
      throw e;
    }

    // Outside the lock: create the Discord channel. The DB row is
    // already committed; if this fails, we delete the orphan row
    // (~1ms) instead of the orphan channel (~1-5s).
    const channelName = formatChannelName(pending.number, input.openerUsername, input.openerId);
    let createdChannelId: string;
    try {
      const result = await this.gateway.createTicketChannel({
        guildId: input.guildId,
        parentId: type.activeCategoryId,
        name: channelName,
        topic: `Ticket #${String(pending.number)} • opened by <@${input.openerId}>`,
        openerId: input.openerId,
        supportRoleIds: type.supportRoleIds,
      });
      createdChannelId = result.channelId;
    } catch (e) {
      // Roll back the row so the user can retry without hitting
      // alreadyOpen. Cascade drops the 'opened' event with it.
      await this.db
        .delete(schema.ticket)
        .where(eq(schema.ticket.id, pending.id))
        .catch(() => undefined);
      if (e instanceof DiscordApiError) return err(e);
      throw e;
    }

    // Patch the placeholder channelId with the real one. Single
    // statement, no transaction needed — the row is already in its
    // final shape modulo this column.
    const [withChannel] = await this.db
      .update(schema.ticket)
      .set({ channelId: createdChannelId })
      .where(eq(schema.ticket.id, pending.id))
      .returning();
    const ticket = withChannel ?? pending;

    // Send the welcome message and pin it. Failure is non-fatal — the
    // channel works, the next state change will rebuild the welcome.
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
        channelId: createdChannelId,
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
