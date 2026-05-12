import {
  and,
  type DbDrizzle,
  eq,
  schema,
  ReactionRolesAction,
  type ReactionRolesOption,
  type ReactionRolesPanel,
  sql,
} from '@hearth/database';
import {
  ConflictError,
  DiscordApiError,
  err,
  NotFoundError,
  ok,
  type Result,
  ValidationError,
} from '@hearth/shared';
import type { ReactionRolesGateway } from '@hearth/tickets-core';

import { reactionRoles as i18n } from '../i18n/index.js';

import {
  MAX_OPTIONS_PER_PANEL,
  type ReactionRolesOptionEditInput,
  type ReactionRolesOptionInput,
  type ReactionRolesPanelWithOptions,
  sortOptions,
} from './_shared.js';

// Option-shaped operations: option CRUD + audit-log derived holder
// queries + best-effort role-revoke from holders. The audit query
// runs SQL-side (HAVING on a SUM/CASE) to keep it sub-second on
// options with tens of thousands of events.

export class ReactionRolesOptionOperations {
  // Branding intentionally omitted — option-shape operations never
  // produce an embed payload, so they don't need the brand colour.
  // The other two operation classes (panel, reaction) take it.
  public constructor(
    private readonly db: DbDrizzle,
    private readonly gateway: ReactionRolesGateway,
  ) {}

  public async addOption(
    panelId: string,
    input: ReactionRolesOptionInput,
  ): Promise<Result<ReactionRolesOption, ConflictError | NotFoundError | ValidationError>> {
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
      .insert(schema.reactionRolesOption)
      .values({
        panelId,
        label: input.label,
        emoji: input.emoji,
        roleId: input.roleId,
        position: input.position,
      })
      .returning();
    if (created === undefined) {
      throw new Error('Failed to insert ReactionRolesOption');
    }
    return ok(created);
  }

  public async editOption(
    optionId: string,
    input: ReactionRolesOptionEditInput,
  ): Promise<Result<ReactionRolesOption, ConflictError | NotFoundError | ValidationError>> {
    const existing = await this.findOption(optionId);
    if (existing === undefined) return err(new NotFoundError(i18n.errors.optionNotFound));

    if (input.position !== undefined) {
      if (input.position < 0 || input.position > MAX_OPTIONS_PER_PANEL - 1) {
        return err(new ValidationError(i18n.errors.invalidPosition));
      }
    }

    // Sibling collision checks — only the columns the operator is changing.
    if (input.label !== undefined && input.label !== existing.label) {
      const dup = await this.db.query.reactionRolesOption.findFirst({
        where: and(
          eq(schema.reactionRolesOption.panelId, existing.panelId),
          eq(schema.reactionRolesOption.label, input.label),
        ),
      });
      if (dup !== undefined && dup.id !== existing.id) {
        return err(new ConflictError(i18n.errors.duplicateLabel));
      }
    }
    if (input.emoji !== undefined && input.emoji !== existing.emoji) {
      const dup = await this.db.query.reactionRolesOption.findFirst({
        where: and(
          eq(schema.reactionRolesOption.panelId, existing.panelId),
          eq(schema.reactionRolesOption.emoji, input.emoji),
        ),
      });
      if (dup !== undefined && dup.id !== existing.id) {
        return err(new ConflictError(i18n.errors.duplicateEmoji));
      }
    }
    if (input.position !== undefined && input.position !== existing.position) {
      const dup = await this.db.query.reactionRolesOption.findFirst({
        where: and(
          eq(schema.reactionRolesOption.panelId, existing.panelId),
          eq(schema.reactionRolesOption.position, input.position),
        ),
      });
      if (dup !== undefined && dup.id !== existing.id) {
        return err(new ConflictError(i18n.errors.duplicatePosition));
      }
    }

    const updates: Partial<typeof schema.reactionRolesOption.$inferInsert> = {};
    if (input.label !== undefined) updates.label = input.label;
    if (input.emoji !== undefined) updates.emoji = input.emoji;
    if (input.roleId !== undefined) updates.roleId = input.roleId;
    if (input.position !== undefined) updates.position = input.position;

    if (Object.keys(updates).length === 0) return ok(existing);

    const [updated] = await this.db
      .update(schema.reactionRolesOption)
      .set(updates)
      .where(eq(schema.reactionRolesOption.id, optionId))
      .returning();
    if (updated === undefined) return err(new NotFoundError(i18n.errors.optionNotFound));
    return ok(updated);
  }

  /**
   * Audit-log derived list of users currently holding the option's
   * role — net-positive grants (granted − revoked > 0) according to
   * the bot's history. Misses users who got the role outside the bot;
   * still flags users who lost it outside the bot (their subsequent
   * revoke is a Discord no-op).
   */
  public async getOptionHolders(optionId: string): Promise<readonly string[]> {
    // SQL-side net-count aggregation. Each user's `granted` events
    // contribute +1, `revoked` contributes −1, `noop` is 0. Postgres
    // SUM + CASE answers this in one pass over the option's event
    // partition — index-backed, no row materialisation cost.
    //
    // PGlite (used by unit tests) accepts the same dialect.
    const rows = await this.db
      .select({ userId: schema.reactionRolesEvent.userId })
      .from(schema.reactionRolesEvent)
      .where(eq(schema.reactionRolesEvent.optionId, optionId))
      .groupBy(schema.reactionRolesEvent.userId)
      .having(
        sql`SUM(CASE WHEN ${schema.reactionRolesEvent.action} = ${ReactionRolesAction.granted} THEN 1 WHEN ${schema.reactionRolesEvent.action} = ${ReactionRolesAction.revoked} THEN -1 ELSE 0 END) > 0`,
      );
    return rows.map((r) => r.userId);
  }

  /**
   * Best-effort revoke of an option's role from every audit-log
   * holder. The dashboard's "Remove option" modal calls this before
   * the row is deleted (audit log cascades on option delete with
   * optionId → NULL, but the snapshot columns survive). Discord-side
   * rejections are swallowed — the returned count reflects only
   * successful revokes.
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
    await this.db
      .delete(schema.reactionRolesOption)
      .where(eq(schema.reactionRolesOption.id, optionId));
    return ok({ removedId: optionId });
  }

  // ─────────────────────────── private ───────────────────────────

  private async findPanel(panelId: string): Promise<ReactionRolesPanel | undefined> {
    const [row] = await this.db
      .select()
      .from(schema.reactionRolesPanel)
      .where(eq(schema.reactionRolesPanel.id, panelId))
      .limit(1);
    return row;
  }

  private async findOption(optionId: string): Promise<ReactionRolesOption | undefined> {
    const [row] = await this.db
      .select()
      .from(schema.reactionRolesOption)
      .where(eq(schema.reactionRolesOption.id, optionId))
      .limit(1);
    return row;
  }

  private async findPanelWithOptions(
    panelId: string,
  ): Promise<ReactionRolesPanelWithOptions | undefined> {
    const row = await this.db.query.reactionRolesPanel.findFirst({
      where: eq(schema.reactionRolesPanel.id, panelId),
      with: { options: true },
    });
    if (row === undefined) return undefined;
    return { ...row, options: sortOptions(row.options) };
  }
}
