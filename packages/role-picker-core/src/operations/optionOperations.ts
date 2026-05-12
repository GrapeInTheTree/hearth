import {
  and,
  type DbDrizzle,
  eq,
  RolePickerAction,
  type RolePickerOption,
  type RolePickerPanel,
  schema,
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
import type { RolePickerGateway } from '@hearth/tickets-core';

import { rolePicker as i18n } from '../i18n/index.js';

import {
  MAX_OPTIONS_PER_PANEL,
  type RolePickerOptionEditInput,
  type RolePickerOptionInput,
  type RolePickerPanelWithOptions,
  sortOptions,
} from './_shared.js';

// Option-shaped operations: option CRUD + audit-log derived holder
// queries + best-effort role-revoke. SQL net-count aggregation drives
// the holder query so it stays sub-second on options with tens of
// thousands of events (Q2 lesson).

export class RolePickerOptionOperations {
  // Branding omitted — option ops never produce embed payloads.
  public constructor(
    private readonly db: DbDrizzle,
    private readonly gateway: RolePickerGateway,
  ) {}

  public async addOption(
    panelId: string,
    input: RolePickerOptionInput,
  ): Promise<Result<RolePickerOption, ConflictError | NotFoundError | ValidationError>> {
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
    if (panel.options.some((o) => o.position === input.position)) {
      return err(new ConflictError(i18n.errors.duplicatePosition));
    }
    if (panel.options.some((o) => o.roleId === input.roleId)) {
      return err(new ConflictError(i18n.errors.duplicateRole));
    }
    const [created] = await this.db
      .insert(schema.rolePickerOption)
      .values({
        panelId,
        label: input.label,
        description: input.description ?? null,
        emoji: input.emoji ?? null,
        roleId: input.roleId,
        position: input.position,
      })
      .returning();
    if (created === undefined) {
      throw new Error('Failed to insert RolePickerOption');
    }
    return ok(created);
  }

  public async editOption(
    optionId: string,
    input: RolePickerOptionEditInput,
  ): Promise<Result<RolePickerOption, ConflictError | NotFoundError | ValidationError>> {
    const existing = await this.findOption(optionId);
    if (existing === undefined) return err(new NotFoundError(i18n.errors.optionNotFound));

    if (input.position !== undefined) {
      if (input.position < 0 || input.position > MAX_OPTIONS_PER_PANEL - 1) {
        return err(new ValidationError(i18n.errors.invalidPosition));
      }
    }

    // Sibling collision checks — only the columns the operator is changing.
    if (input.label !== undefined && input.label !== existing.label) {
      const dup = await this.db.query.rolePickerOption.findFirst({
        where: and(
          eq(schema.rolePickerOption.panelId, existing.panelId),
          eq(schema.rolePickerOption.label, input.label),
        ),
      });
      if (dup !== undefined && dup.id !== existing.id) {
        return err(new ConflictError(i18n.errors.duplicateLabel));
      }
    }
    if (input.position !== undefined && input.position !== existing.position) {
      const dup = await this.db.query.rolePickerOption.findFirst({
        where: and(
          eq(schema.rolePickerOption.panelId, existing.panelId),
          eq(schema.rolePickerOption.position, input.position),
        ),
      });
      if (dup !== undefined && dup.id !== existing.id) {
        return err(new ConflictError(i18n.errors.duplicatePosition));
      }
    }
    if (input.roleId !== undefined && input.roleId !== existing.roleId) {
      const dup = await this.db.query.rolePickerOption.findFirst({
        where: and(
          eq(schema.rolePickerOption.panelId, existing.panelId),
          eq(schema.rolePickerOption.roleId, input.roleId),
        ),
      });
      if (dup !== undefined && dup.id !== existing.id) {
        return err(new ConflictError(i18n.errors.duplicateRole));
      }
    }

    const updates: Partial<typeof schema.rolePickerOption.$inferInsert> = {};
    if (input.label !== undefined) updates.label = input.label;
    if (input.description !== undefined) updates.description = input.description;
    if (input.emoji !== undefined) updates.emoji = input.emoji;
    if (input.roleId !== undefined) updates.roleId = input.roleId;
    if (input.position !== undefined) updates.position = input.position;

    if (Object.keys(updates).length === 0) return ok(existing);

    const [updated] = await this.db
      .update(schema.rolePickerOption)
      .set(updates)
      .where(eq(schema.rolePickerOption.id, optionId))
      .returning();
    if (updated === undefined) return err(new NotFoundError(i18n.errors.optionNotFound));
    return ok(updated);
  }

  /**
   * Audit-log derived list of users currently holding the option's
   * role — net-positive grants (granted − revoked > 0) according to
   * the bot's history. Failure-variant rows are neutral. Misses users
   * who got the role outside the bot.
   */
  public async getOptionHolders(optionId: string): Promise<readonly string[]> {
    // SQL net-count aggregation. `granted` → +1, `revoked` → −1,
    // failure variants → 0. Postgres SUM + CASE answers in one pass
    // over the option's event partition.
    const rows = await this.db
      .select({ userId: schema.rolePickerEvent.userId })
      .from(schema.rolePickerEvent)
      .where(eq(schema.rolePickerEvent.optionId, optionId))
      .groupBy(schema.rolePickerEvent.userId)
      .having(
        sql`SUM(CASE WHEN ${schema.rolePickerEvent.action} = ${RolePickerAction.granted} THEN 1 WHEN ${schema.rolePickerEvent.action} = ${RolePickerAction.revoked} THEN -1 ELSE 0 END) > 0`,
      );
    return rows.map((r) => r.userId);
  }

  /**
   * Best-effort revoke of an option's role from every audit-log holder.
   * The dashboard's "Remove option" modal calls this before the row is
   * deleted. Discord-side rejections are swallowed — the returned count
   * reflects only successful revokes.
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
    await this.db.delete(schema.rolePickerOption).where(eq(schema.rolePickerOption.id, optionId));
    return ok({ removedId: optionId });
  }

  // ─────────────────────────── private ───────────────────────────

  private async findPanel(panelId: string): Promise<RolePickerPanel | undefined> {
    const [row] = await this.db
      .select()
      .from(schema.rolePickerPanel)
      .where(eq(schema.rolePickerPanel.id, panelId))
      .limit(1);
    return row;
  }

  private async findOption(optionId: string): Promise<RolePickerOption | undefined> {
    const [row] = await this.db
      .select()
      .from(schema.rolePickerOption)
      .where(eq(schema.rolePickerOption.id, optionId))
      .limit(1);
    return row;
  }

  private async findPanelWithOptions(
    panelId: string,
  ): Promise<RolePickerPanelWithOptions | undefined> {
    const row = await this.db.query.rolePickerPanel.findFirst({
      where: eq(schema.rolePickerPanel.id, panelId),
      with: { options: true },
    });
    if (row === undefined) return undefined;
    return { ...row, options: sortOptions(row.options) };
  }
}
