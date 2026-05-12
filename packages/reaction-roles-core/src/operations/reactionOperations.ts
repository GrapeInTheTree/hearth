import {
  and,
  asc,
  count,
  type DbDrizzle,
  eq,
  schema,
  ReactionRolesAction,
  type ReactionRolesEvent,
  type ReactionRolesOption,
  type ReactionRolesPanel,
} from '@hearth/database';
import { type AppError, DiscordApiError, ok, type Result } from '@hearth/shared';
import type { ReactionRolesGateway } from '@hearth/tickets-core';

import type { ReactionRolesReactionResult } from './_shared.js';

// Reaction-shaped operations: listener handlers + audit-log
// reads. The handlers map raw (messageId, emoji, userId, guildId)
// tuples to role ops + audit writes; lookup misses go silently noop
// because the listener fires for every reaction in every guild and we
// don't want unrelated reactions to spam DB writes.

export class ReactionRolesReactionOperations {
  public constructor(
    private readonly db: DbDrizzle,
    private readonly gateway: ReactionRolesGateway,
  ) {}

  /**
   * Process a reaction-add event.
   *   ① Look up panel by messageId; miss → noop (other message).
   *   ② Look up option by (panelId, emoji); miss → noop (unrelated).
   *   ③ Try gateway.assignRoleToMember:
   *       - DiscordApiError (perms / hierarchy) → audit('noop').
   *       - Success → audit('granted').
   *
   * The DB write (event) and Discord write (assignRole) are
   * sequential but not transactional. A successful assign followed by
   * an event-write crash is the only "lost audit" path — Discord's
   * own audit log carries the role grant regardless.
   */
  public async handleReactionAdd(input: {
    readonly messageId: string;
    readonly emoji: string;
    readonly userId: string;
    readonly guildId: string;
  }): Promise<Result<ReactionRolesReactionResult, AppError>> {
    const lookup = await this.lookupPanelAndOption(input.messageId, input.emoji);
    if (lookup === undefined) {
      return ok({ action: ReactionRolesAction.noop });
    }
    const { panel, option } = lookup;
    try {
      await this.gateway.assignRoleToMember(panel.guildId, input.userId, option.roleId);
    } catch (error) {
      if (error instanceof DiscordApiError) {
        await this.recordEvent(panel.id, input.userId, option, ReactionRolesAction.noop);
        return ok({ action: ReactionRolesAction.noop, roleId: option.roleId });
      }
      throw error;
    }
    await this.recordEvent(panel.id, input.userId, option, ReactionRolesAction.granted);
    return ok({ action: ReactionRolesAction.granted, roleId: option.roleId });
  }

  /**
   * Process a reaction-remove event. Mirror of handleReactionAdd.
   * Discord rejecting "remove role not held" lands as 50013 family
   * which we map to 'noop' — listener never throws past entry.
   */
  public async handleReactionRemove(input: {
    readonly messageId: string;
    readonly emoji: string;
    readonly userId: string;
    readonly guildId: string;
  }): Promise<Result<ReactionRolesReactionResult, AppError>> {
    const lookup = await this.lookupPanelAndOption(input.messageId, input.emoji);
    if (lookup === undefined) return ok({ action: ReactionRolesAction.noop });
    const { panel, option } = lookup;
    try {
      await this.gateway.removeRoleFromMember(panel.guildId, input.userId, option.roleId);
    } catch (error) {
      if (error instanceof DiscordApiError) {
        await this.recordEvent(panel.id, input.userId, option, ReactionRolesAction.noop);
        return ok({ action: ReactionRolesAction.noop, roleId: option.roleId });
      }
      throw error;
    }
    await this.recordEvent(panel.id, input.userId, option, ReactionRolesAction.revoked);
    return ok({ action: ReactionRolesAction.revoked, roleId: option.roleId });
  }

  // ─────────────────────────── audit ───────────────────────────

  public async listEvents(panelId: string, limit = 50): Promise<ReactionRolesEvent[]> {
    return await this.db
      .select()
      .from(schema.reactionRolesEvent)
      .where(eq(schema.reactionRolesEvent.panelId, panelId))
      .orderBy(asc(schema.reactionRolesEvent.createdAt))
      .limit(limit);
  }

  public async countEvents(panelId: string): Promise<number> {
    const [row] = await this.db
      .select({ value: count() })
      .from(schema.reactionRolesEvent)
      .where(eq(schema.reactionRolesEvent.panelId, panelId));
    return row?.value ?? 0;
  }

  // ─────────────────────────── private ───────────────────────────

  /** Reaction → (panel, option) lookup. Used by both add and remove
   *  handlers. Returns undefined when either lookup misses (other
   *  panels, unrelated bot messages, freeform user reactions). */
  private async lookupPanelAndOption(
    messageId: string,
    emoji: string,
  ): Promise<{ panel: ReactionRolesPanel; option: ReactionRolesOption } | undefined> {
    const panel = await this.db.query.reactionRolesPanel.findFirst({
      where: eq(schema.reactionRolesPanel.messageId, messageId),
    });
    if (panel === undefined) return undefined;
    const option = await this.db.query.reactionRolesOption.findFirst({
      where: and(
        eq(schema.reactionRolesOption.panelId, panel.id),
        eq(schema.reactionRolesOption.emoji, emoji),
      ),
    });
    if (option === undefined) return undefined;
    return { panel, option };
  }

  /**
   * Record an audit event. Snapshots option label / emoji / roleId
   * onto the row so the event survives option deletion (FK is
   * ON DELETE SET NULL — see migration 0003).
   */
  private async recordEvent(
    panelId: string,
    userId: string,
    option: Pick<ReactionRolesOption, 'id' | 'label' | 'emoji' | 'roleId'>,
    action: ReactionRolesAction,
  ): Promise<void> {
    await this.db.insert(schema.reactionRolesEvent).values({
      panelId,
      userId,
      optionId: option.id,
      optionLabel: option.label,
      optionEmoji: option.emoji,
      optionRoleId: option.roleId,
      action,
    });
  }
}
