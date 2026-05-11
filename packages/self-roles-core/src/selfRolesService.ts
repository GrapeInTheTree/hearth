import {
  and,
  asc,
  count,
  type DbDrizzle,
  eq,
  schema,
  SelfRolesAction,
  type SelfRolesEvent,
  type SelfRolesOption,
  type SelfRolesPanel,
  sql,
} from '@hearth/database';
import {
  type AppError,
  ConflictError,
  DiscordApiError,
  err,
  NotFoundError,
  ok,
  type Result,
  ValidationError,
} from '@hearth/shared';
import type { Branding, DiscordGateway } from '@hearth/tickets-core';

import { selfRoles as i18n } from './i18n/index.js';
import { buildSelfRolesPayload } from './lib/selfRolesBuilder.js';

const PLACEHOLDER_MESSAGE_ID = 'pending';
const MAX_OPTIONS_PER_PANEL = 20;

export interface SelfRolesPanelInput {
  readonly guildId: string;
  readonly channelId: string;
  /** Operator-supplied embed title; falls back to i18n default. */
  readonly embedTitle?: string;
  /** Operator-supplied embed description; falls back to i18n default. */
  readonly embedDescription?: string;
}

export interface SelfRolesPanelEditInput {
  readonly channelId?: string;
  readonly embedTitle?: string;
  readonly embedDescription?: string;
}

export interface SelfRolesOptionInput {
  readonly label: string;
  readonly emoji: string;
  readonly roleId: string;
  readonly position: number;
}

export interface SelfRolesOptionEditInput {
  readonly label?: string;
  readonly emoji?: string;
  readonly roleId?: string;
  readonly position?: number;
}

export interface SelfRolesPanelWithOptions extends SelfRolesPanel {
  readonly options: SelfRolesOption[];
}

export interface SelfRolesCreateResult {
  readonly panel: SelfRolesPanel;
  readonly created: boolean;
}

/** Outcome of a single reaction event. 'noop' covers anything that left the
 *  user's role state unchanged — Discord rejected the role op (perms /
 *  hierarchy / unknown emoji), or the reaction targeted a message/emoji the
 *  bot doesn't track (the listener filters those upstream, but the service
 *  also returns noop defensively). */
export interface SelfRolesReactionResult {
  readonly action: SelfRolesAction;
  readonly roleId?: string;
}

/**
 * Self-roles panels host multi-select language buckets. Each option binds
 * an emoji to a role; the user adds the reaction to gain the role, removes
 * it to give the role back. Audit events record granted / revoked / noop
 * outcomes.
 *
 * Order of operations on create / add: persist DB first, render Discord
 * after — service stores the bot's chosen messageId back on the row so a
 * mid-flow Discord failure leaves the panel/options intact for a repost
 * retry. Render also pre-adds one reaction per option so the strip is
 * live the moment users see the message.
 */
export class SelfRolesService {
  public constructor(
    private readonly db: DbDrizzle,
    private readonly gateway: DiscordGateway,
    private readonly branding: Branding,
  ) {}

  // ─────────────────────────── panel ───────────────────────────

  /**
   * Create a new self-roles panel with no options. Operator must add
   * options + render before reactions become useful. Two panels can
   * coexist in the same channel only after the first one has been
   * published with a real messageId — the (guildId, channelId, messageId)
   * unique index would otherwise reject the second placeholder.
   */
  public async createPanel(
    input: SelfRolesPanelInput,
  ): Promise<Result<SelfRolesCreateResult, ConflictError | ValidationError>> {
    const embedTitle = input.embedTitle ?? i18n.panel.defaultEmbedTitle;
    const embedDescription = input.embedDescription ?? i18n.panel.defaultEmbedDescription;

    const placeholderInUse = await this.db.query.selfRolesPanel.findFirst({
      where: and(
        eq(schema.selfRolesPanel.guildId, input.guildId),
        eq(schema.selfRolesPanel.channelId, input.channelId),
        eq(schema.selfRolesPanel.messageId, PLACEHOLDER_MESSAGE_ID),
      ),
    });
    if (placeholderInUse !== undefined) {
      return err(
        new ConflictError(
          'A self-roles panel is already pending publish on this channel. Repost or delete it first.',
        ),
      );
    }

    const [created] = await this.db
      .insert(schema.selfRolesPanel)
      .values({
        guildId: input.guildId,
        channelId: input.channelId,
        messageId: PLACEHOLDER_MESSAGE_ID,
        embedTitle,
        embedDescription,
      })
      .returning();
    if (created === undefined) {
      throw new Error('Failed to insert SelfRolesPanel row');
    }
    return ok({ panel: created, created: true });
  }

  public async editPanel(
    panelId: string,
    input: SelfRolesPanelEditInput,
  ): Promise<Result<SelfRolesPanel, NotFoundError>> {
    const existing = await this.findPanel(panelId);
    if (existing === undefined) {
      return err(new NotFoundError(i18n.errors.panelNotFound));
    }
    const updates: Partial<typeof schema.selfRolesPanel.$inferInsert> = {};
    if (input.channelId !== undefined) updates.channelId = input.channelId;
    if (input.embedTitle !== undefined) updates.embedTitle = input.embedTitle;
    if (input.embedDescription !== undefined) updates.embedDescription = input.embedDescription;
    if (Object.keys(updates).length === 0) return ok(existing);
    const [updated] = await this.db
      .update(schema.selfRolesPanel)
      .set(updates)
      .where(eq(schema.selfRolesPanel.id, panelId))
      .returning();
    if (updated === undefined) {
      return err(new NotFoundError(i18n.errors.panelNotFound));
    }
    return ok(updated);
  }

  public async listPanels(guildId: string): Promise<SelfRolesPanelWithOptions[]> {
    const rows = await this.db.query.selfRolesPanel.findMany({
      where: eq(schema.selfRolesPanel.guildId, guildId),
      with: { options: true },
      orderBy: [asc(schema.selfRolesPanel.createdAt)],
    });
    return rows.map((r) => ({ ...r, options: sortOptions(r.options) }));
  }

  public async getPanel(
    panelId: string,
  ): Promise<Result<SelfRolesPanelWithOptions, NotFoundError>> {
    const row = await this.db.query.selfRolesPanel.findFirst({
      where: eq(schema.selfRolesPanel.id, panelId),
      with: { options: true },
    });
    if (row === undefined) return err(new NotFoundError(i18n.errors.panelNotFound));
    return ok({ ...row, options: sortOptions(row.options) });
  }

  /**
   * Re-render the panel's Discord message from current DB state, and
   * synchronise the bot's pre-added reactions. Idempotent — the dashboard
   * internal-API hook calls this after every CRUD mutation. If the live
   * message has been deleted (manually or otherwise) the edit path falls
   * through to send + addReactions.
   */
  public async renderPanel(
    panelId: string,
  ): Promise<Result<{ messageId: string; recreated: boolean }, NotFoundError>> {
    const panelResult = await this.getPanel(panelId);
    if (!panelResult.ok) return panelResult;
    const result = await this.rerenderPanel(panelResult.value);
    return ok(result);
  }

  /**
   * Drop the existing message and post a fresh one with the same DB state.
   * Reactions are re-seeded. Useful when the panel scrolled out of sight
   * after channel activity. Existing role grants on users stay intact —
   * removing the old message doesn't revoke roles already in place.
   */
  public async repostPanel(
    panelId: string,
  ): Promise<Result<{ messageId: string; previousMessageId: string }, NotFoundError>> {
    const panelResult = await this.getPanel(panelId);
    if (!panelResult.ok) return panelResult;
    const panel = panelResult.value;
    const previousMessageId = panel.messageId;
    if (previousMessageId !== PLACEHOLDER_MESSAGE_ID) {
      // Best-effort delete — gateway swallows 404 so already-gone messages
      // don't fail the flow.
      await this.gateway.deleteSelfRolesMessage(panel.channelId, previousMessageId);
    }
    const payload = buildSelfRolesPayload(panel, panel.options, this.branding);
    const { messageId } = await this.gateway.sendSelfRolesMessage(panel.channelId, payload);
    await this.db
      .update(schema.selfRolesPanel)
      .set({ messageId })
      .where(eq(schema.selfRolesPanel.id, panel.id));
    if (payload.reactions.length > 0) {
      // Best-effort — a single unknown emoji shouldn't drop the whole
      // panel back to "pending". Per-option failures surface later when
      // users try to use them.
      await this.gateway
        .syncBotReactions(panel.channelId, messageId, payload.reactions)
        .catch(() => undefined);
    }
    return ok({ messageId, previousMessageId });
  }

  /**
   * Hard-delete a panel: blank-out the live message (so any in-flight
   * reaction has nothing to bind to), delete it, and remove the DB row.
   * Cascades to SelfRolesOption + SelfRolesEvent via FK. Existing role
   * grants on users stay — operators clean those up via /selfroles or
   * the dashboard "Sweep" backlog feature.
   */
  public async deletePanel(panelId: string): Promise<Result<{ panelId: string }, NotFoundError>> {
    const panel = await this.findPanel(panelId);
    if (panel === undefined) return err(new NotFoundError(i18n.errors.panelNotFound));
    if (panel.messageId !== PLACEHOLDER_MESSAGE_ID) {
      await this.gateway
        .editSelfRolesMessage(panel.channelId, panel.messageId, {
          content: undefined,
          embeds: [],
          components: [],
        })
        .catch(() => undefined);
      await this.gateway
        .deleteSelfRolesMessage(panel.channelId, panel.messageId)
        .catch(() => undefined);
    }
    await this.db.delete(schema.selfRolesPanel).where(eq(schema.selfRolesPanel.id, panelId));
    return ok({ panelId });
  }

  // ─────────────────────────── options ───────────────────────────

  public async addOption(
    panelId: string,
    input: SelfRolesOptionInput,
  ): Promise<Result<SelfRolesOption, ConflictError | NotFoundError | ValidationError>> {
    if (input.position < 0 || input.position > MAX_OPTIONS_PER_PANEL - 1) {
      return err(new ValidationError(i18n.errors.invalidPosition));
    }
    const panel = await this.findPanelWithOptions(panelId);
    if (panel === undefined) return err(new NotFoundError(i18n.errors.panelNotFound));
    if (panel.options.length >= MAX_OPTIONS_PER_PANEL) {
      return err(new ConflictError(i18n.errors.optionLimitReached));
    }
    if (panel.options.some((o) => o.label === input.label)) {
      return err(new ConflictError(i18n.errors.duplicateLabel));
    }
    if (panel.options.some((o) => o.emoji === input.emoji)) {
      return err(new ConflictError(i18n.errors.duplicateEmoji));
    }
    if (panel.options.some((o) => o.position === input.position)) {
      return err(new ConflictError(i18n.errors.duplicatePosition));
    }
    const [created] = await this.db
      .insert(schema.selfRolesOption)
      .values({
        panelId,
        label: input.label,
        emoji: input.emoji,
        roleId: input.roleId,
        position: input.position,
      })
      .returning();
    if (created === undefined) {
      throw new Error('Failed to insert SelfRolesOption');
    }
    return ok(created);
  }

  public async editOption(
    optionId: string,
    input: SelfRolesOptionEditInput,
  ): Promise<Result<SelfRolesOption, ConflictError | NotFoundError | ValidationError>> {
    const existing = await this.findOption(optionId);
    if (existing === undefined) return err(new NotFoundError(i18n.errors.optionNotFound));

    if (input.position !== undefined) {
      if (input.position < 0 || input.position > MAX_OPTIONS_PER_PANEL - 1) {
        return err(new ValidationError(i18n.errors.invalidPosition));
      }
    }

    // Sibling collision checks — only the columns the operator is changing.
    if (input.label !== undefined && input.label !== existing.label) {
      const dup = await this.db.query.selfRolesOption.findFirst({
        where: and(
          eq(schema.selfRolesOption.panelId, existing.panelId),
          eq(schema.selfRolesOption.label, input.label),
        ),
      });
      if (dup !== undefined && dup.id !== existing.id) {
        return err(new ConflictError(i18n.errors.duplicateLabel));
      }
    }
    if (input.emoji !== undefined && input.emoji !== existing.emoji) {
      const dup = await this.db.query.selfRolesOption.findFirst({
        where: and(
          eq(schema.selfRolesOption.panelId, existing.panelId),
          eq(schema.selfRolesOption.emoji, input.emoji),
        ),
      });
      if (dup !== undefined && dup.id !== existing.id) {
        return err(new ConflictError(i18n.errors.duplicateEmoji));
      }
    }
    if (input.position !== undefined && input.position !== existing.position) {
      const dup = await this.db.query.selfRolesOption.findFirst({
        where: and(
          eq(schema.selfRolesOption.panelId, existing.panelId),
          eq(schema.selfRolesOption.position, input.position),
        ),
      });
      if (dup !== undefined && dup.id !== existing.id) {
        return err(new ConflictError(i18n.errors.duplicatePosition));
      }
    }

    const updates: Partial<typeof schema.selfRolesOption.$inferInsert> = {};
    if (input.label !== undefined) updates.label = input.label;
    if (input.emoji !== undefined) updates.emoji = input.emoji;
    if (input.roleId !== undefined) updates.roleId = input.roleId;
    if (input.position !== undefined) updates.position = input.position;

    if (Object.keys(updates).length === 0) return ok(existing);

    const [updated] = await this.db
      .update(schema.selfRolesOption)
      .set(updates)
      .where(eq(schema.selfRolesOption.id, optionId))
      .returning();
    if (updated === undefined) return err(new NotFoundError(i18n.errors.optionNotFound));
    return ok(updated);
  }

  /**
   * Audit-log derived list of users currently holding the option's role —
   * net-positive grants (granted - revoked > 0) according to the bot's
   * history. Does NOT consult Discord, so users who got the role via
   * manual admin assignment are missed; conversely, users who had the
   * role removed by an admin outside the bot still show up here and the
   * subsequent revoke call is a Discord no-op. Sufficient for the
   * common case (operator deletes a self-roles option and wants the
   * roles it ever handed out cleaned up).
   */
  public async getOptionHolders(optionId: string): Promise<readonly string[]> {
    // SQL-side net-count aggregation. Each user's `granted` events
    // contribute +1, `revoked` events contribute −1, anything else
    // (e.g. `noop`) contributes 0. Postgres SUM + CASE handles this
    // in one pass over the option's event partition with no row
    // materialisation cost — the previous JS-Map implementation
    // pulled every event into memory, which broke down at ~50k
    // events per option (popular language on a large guild after a
    // year of activity).
    //
    // PGlite (used by unit tests) accepts the same dialect, so this
    // works in both the test harness and production Postgres.
    const rows = await this.db
      .select({ userId: schema.selfRolesEvent.userId })
      .from(schema.selfRolesEvent)
      .where(eq(schema.selfRolesEvent.optionId, optionId))
      .groupBy(schema.selfRolesEvent.userId)
      .having(
        sql`SUM(CASE WHEN ${schema.selfRolesEvent.action} = ${SelfRolesAction.granted} THEN 1 WHEN ${schema.selfRolesEvent.action} = ${SelfRolesAction.revoked} THEN -1 ELSE 0 END) > 0`,
      );
    return rows.map((r) => r.userId);
  }

  /**
   * Best-effort revoke of an option's role from every audit-log-derived
   * holder. The dashboard's "Remove option" modal calls this *before*
   * the row is deleted (audit log cascades on option delete, so we'd
   * lose the holder list otherwise). Discord-side rejections (Manage
   * Roles missing, role hierarchy, unknown member) are swallowed — the
   * returned count reflects only successful revokes so the dashboard
   * toast can name "revoked from N of M users".
   */
  public async revokeRoleFromOptionHolders(
    optionId: string,
  ): Promise<Result<{ revokedCount: number }, NotFoundError>> {
    const existing = await this.findOption(optionId);
    if (existing === undefined) return err(new NotFoundError(i18n.errors.optionNotFound));
    const panel = await this.findPanel(existing.panelId);
    if (panel === undefined) return err(new NotFoundError(i18n.errors.panelNotFound));

    const holders = await this.getOptionHolders(optionId);
    let revokedCount = 0;
    for (const userId of holders) {
      try {
        await this.gateway.removeRoleFromMember(panel.guildId, userId, existing.roleId);
        revokedCount += 1;
      } catch (error) {
        if (!(error instanceof DiscordApiError)) {
          throw error;
        }
      }
    }
    return ok({ revokedCount });
  }

  public async removeOption(
    optionId: string,
  ): Promise<Result<{ removedId: string }, NotFoundError>> {
    const existing = await this.findOption(optionId);
    if (existing === undefined) return err(new NotFoundError(i18n.errors.optionNotFound));
    await this.db.delete(schema.selfRolesOption).where(eq(schema.selfRolesOption.id, optionId));
    return ok({ removedId: optionId });
  }

  // ────────────────────── reaction handlers ──────────────────────

  /**
   * Process a reaction-add event.
   *  ① Look up panel by messageId; miss → noop (other message).
   *  ② Look up option by (panelId, emoji); miss → noop (unrelated reaction).
   *  ③ Try gateway.assignRoleToMember:
   *      - DiscordApiError (perms / hierarchy / unknown emoji) → audit('noop').
   *      - Success → audit('granted').
   *
   * The DB write (event) and Discord write (assignRole) are sequential
   * but not transactional. A successful assign followed by an event-write
   * crash is the only "lost audit" path; production logs would still
   * carry the granted role event from Discord's audit log.
   */
  public async handleReactionAdd(input: {
    readonly messageId: string;
    readonly emoji: string;
    readonly userId: string;
    readonly guildId: string;
  }): Promise<Result<SelfRolesReactionResult, AppError>> {
    const lookup = await this.lookupPanelAndOption(input.messageId, input.emoji);
    if (lookup === undefined) {
      // No panel/option binding — silent noop. Don't audit here because
      // we have no panelId/optionId to attach the event to.
      return ok({ action: SelfRolesAction.noop });
    }
    const { panel, option } = lookup;
    try {
      await this.gateway.assignRoleToMember(panel.guildId, input.userId, option.roleId);
    } catch (error) {
      if (error instanceof DiscordApiError) {
        await this.recordEvent(panel.id, input.userId, option.id, SelfRolesAction.noop);
        return ok({ action: SelfRolesAction.noop, roleId: option.roleId });
      }
      throw error;
    }
    await this.recordEvent(panel.id, input.userId, option.id, SelfRolesAction.granted);
    return ok({ action: SelfRolesAction.granted, roleId: option.roleId });
  }

  /**
   * Process a reaction-remove event. Mirror of handleReactionAdd:
   *  ① Lookup; miss → noop.
   *  ② Try gateway.removeRoleFromMember → success ⇒ 'revoked', error ⇒ 'noop'.
   *
   * Idempotent in practice — Discord rejects "remove role not held" as a
   * 50013 family error, which we map to 'noop' rather than failing the
   * listener.
   */
  public async handleReactionRemove(input: {
    readonly messageId: string;
    readonly emoji: string;
    readonly userId: string;
    readonly guildId: string;
  }): Promise<Result<SelfRolesReactionResult, AppError>> {
    const lookup = await this.lookupPanelAndOption(input.messageId, input.emoji);
    if (lookup === undefined) return ok({ action: SelfRolesAction.noop });
    const { panel, option } = lookup;
    try {
      await this.gateway.removeRoleFromMember(panel.guildId, input.userId, option.roleId);
    } catch (error) {
      if (error instanceof DiscordApiError) {
        await this.recordEvent(panel.id, input.userId, option.id, SelfRolesAction.noop);
        return ok({ action: SelfRolesAction.noop, roleId: option.roleId });
      }
      throw error;
    }
    await this.recordEvent(panel.id, input.userId, option.id, SelfRolesAction.revoked);
    return ok({ action: SelfRolesAction.revoked, roleId: option.roleId });
  }

  // ─────────────────────────── audit ───────────────────────────

  public async listEvents(panelId: string, limit = 50): Promise<SelfRolesEvent[]> {
    return await this.db
      .select()
      .from(schema.selfRolesEvent)
      .where(eq(schema.selfRolesEvent.panelId, panelId))
      .orderBy(asc(schema.selfRolesEvent.createdAt))
      .limit(limit);
  }

  public async countEvents(panelId: string): Promise<number> {
    const [row] = await this.db
      .select({ value: count() })
      .from(schema.selfRolesEvent)
      .where(eq(schema.selfRolesEvent.panelId, panelId));
    return row?.value ?? 0;
  }

  // ─────────────────────────── private ───────────────────────────

  private async findPanel(panelId: string): Promise<SelfRolesPanel | undefined> {
    const [row] = await this.db
      .select()
      .from(schema.selfRolesPanel)
      .where(eq(schema.selfRolesPanel.id, panelId))
      .limit(1);
    return row;
  }

  private async findPanelWithOptions(
    panelId: string,
  ): Promise<SelfRolesPanelWithOptions | undefined> {
    const row = await this.db.query.selfRolesPanel.findFirst({
      where: eq(schema.selfRolesPanel.id, panelId),
      with: { options: true },
    });
    if (row === undefined) return undefined;
    return { ...row, options: sortOptions(row.options) };
  }

  private async findOption(optionId: string): Promise<SelfRolesOption | undefined> {
    const [row] = await this.db
      .select()
      .from(schema.selfRolesOption)
      .where(eq(schema.selfRolesOption.id, optionId))
      .limit(1);
    return row;
  }

  /** Reaction → (panel, option) lookup. Used by both add and remove
   *  handlers. Returns undefined when either the message or emoji doesn't
   *  bind to a known self-roles record (other panels, unrelated bot
   *  messages, freeform reactions from users). */
  private async lookupPanelAndOption(
    messageId: string,
    emoji: string,
  ): Promise<{ panel: SelfRolesPanel; option: SelfRolesOption } | undefined> {
    const panel = await this.db.query.selfRolesPanel.findFirst({
      where: eq(schema.selfRolesPanel.messageId, messageId),
    });
    if (panel === undefined) return undefined;
    const option = await this.db.query.selfRolesOption.findFirst({
      where: and(
        eq(schema.selfRolesOption.panelId, panel.id),
        eq(schema.selfRolesOption.emoji, emoji),
      ),
    });
    if (option === undefined) return undefined;
    return { panel, option };
  }

  private async rerenderPanel(
    panel: SelfRolesPanelWithOptions,
  ): Promise<{ messageId: string; recreated: boolean }> {
    const payload = buildSelfRolesPayload(panel, panel.options, this.branding);
    if (panel.messageId === PLACEHOLDER_MESSAGE_ID) {
      const { messageId } = await this.gateway.sendSelfRolesMessage(panel.channelId, payload);
      await this.db
        .update(schema.selfRolesPanel)
        .set({ messageId })
        .where(eq(schema.selfRolesPanel.id, panel.id));
      if (payload.reactions.length > 0) {
        await this.gateway
          .syncBotReactions(panel.channelId, messageId, payload.reactions)
          .catch(() => undefined);
      }
      return { messageId, recreated: true };
    }
    try {
      await this.gateway.editSelfRolesMessage(panel.channelId, panel.messageId, payload);
      // Reconcile the reaction strip with the current option set:
      // syncBotReactions adds anything missing (e.g. a freshly added
      // option) and strips bot's own orphan reactions from removed
      // options. User reactions are never touched. Re-adding existing
      // reactions is a cheap no-op because message.react is idempotent
      // for the bot's own copy. Empty panels go through this path too
      // — sync becomes a pure "remove all bot reactions" sweep.
      await this.gateway
        .syncBotReactions(panel.channelId, panel.messageId, payload.reactions)
        .catch(() => undefined);
      return { messageId: panel.messageId, recreated: false };
    } catch {
      // Live message gone — recreate.
      const { messageId } = await this.gateway.sendSelfRolesMessage(panel.channelId, payload);
      await this.db
        .update(schema.selfRolesPanel)
        .set({ messageId })
        .where(eq(schema.selfRolesPanel.id, panel.id));
      if (payload.reactions.length > 0) {
        await this.gateway
          .syncBotReactions(panel.channelId, messageId, payload.reactions)
          .catch(() => undefined);
      }
      return { messageId, recreated: true };
    }
  }

  private async recordEvent(
    panelId: string,
    userId: string,
    optionId: string,
    action: SelfRolesAction,
  ): Promise<void> {
    await this.db.insert(schema.selfRolesEvent).values({
      panelId,
      userId,
      optionId,
      action,
    });
  }
}

function sortOptions(options: readonly SelfRolesOption[]): SelfRolesOption[] {
  return [...options].sort((a, b) => a.position - b.position);
}
