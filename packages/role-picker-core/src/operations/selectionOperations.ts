import {
  and,
  asc,
  count,
  type DbDrizzle,
  eq,
  inArray,
  RolePickerAction,
  type RolePickerEvent,
  type RolePickerOption,
  type RolePickerPanel,
  schema,
  sql,
} from '@hearth/database';
import { type AppError, DiscordApiError, ok, type Result } from '@hearth/shared';
import type { RolePickerGateway } from '@hearth/tickets-core';

import type { RolePickerSelectionResult } from './_shared.js';

// Selection-shaped operations: the StringSelectMenu submission handler
// plus audit-log reads. The handler is the unique part of role-picker —
// unlike reactions (per-event add/remove), a select-menu submission
// carries the user's complete desired state in `interaction.values[]`.
// The service diffs that against the user's currently-held roles
// (derived from the audit log) and acts on the delta only.

export class RolePickerSelectionOperations {
  public constructor(
    private readonly db: DbDrizzle,
    private readonly gateway: RolePickerGateway,
  ) {}

  /**
   * Process a role-picker selection submission. Looks up the panel by
   * customId (panelId carried in payload), validates that every
   * selectedValue maps to a real option on the panel, computes the
   * diff against the user's currently-held options, and issues
   * gateway role-ops for the delta.
   *
   *   ① panel lookup by panelId; miss → noop result
   *   ② option lookup for every selectedValue; any miss → fail-soft
   *      noop (the user's client may have picked a stale option that
   *      was removed between render and submit)
   *   ③ derive currentlyHeld = audit-log SUM > 0, partitioned by
   *      (panelId, userId)
   *   ④ toGrant = selectedValues \ currentlyHeld
   *      toRevoke = currentlyHeld \ selectedValues
   *   ⑤ sequential grants then revokes; catch DiscordApiError → audit
   *      a failure-variant row (direction known), result counter +1
   *   ⑥ return counts + labels for the ephemeral confirm
   */
  public async handleSelection(input: {
    readonly panelId: string;
    readonly userId: string;
    readonly selectedValues: readonly string[];
  }): Promise<Result<RolePickerSelectionResult, AppError>> {
    const panel = await this.db.query.rolePickerPanel.findFirst({
      where: eq(schema.rolePickerPanel.id, input.panelId),
      with: { options: true },
    });
    if (panel === undefined) {
      return ok(emptyResult());
    }
    const optionsById = new Map(panel.options.map((o) => [o.id, o]));

    // Validate that every selectedValue maps to a real option. If any
    // miss (stale client state), fail-soft into a noop result so the
    // user gets the "No change." ephemeral and the operator's audit
    // log isn't polluted with phantom rows.
    const selectedOptions: RolePickerOption[] = [];
    for (const value of input.selectedValues) {
      const option = optionsById.get(value);
      if (option === undefined) return ok(emptyResult());
      selectedOptions.push(option);
    }
    const selectedSet = new Set(selectedOptions.map((o) => o.id));

    // Derive currentlyHeld from the audit log. Index `(panelId, userId)`
    // keeps this aggregation index-only on big tables.
    const heldRows = await this.db
      .select({ optionId: schema.rolePickerEvent.optionId })
      .from(schema.rolePickerEvent)
      .where(
        and(
          eq(schema.rolePickerEvent.panelId, panel.id),
          eq(schema.rolePickerEvent.userId, input.userId),
        ),
      )
      .groupBy(schema.rolePickerEvent.optionId)
      .having(
        sql`SUM(CASE WHEN ${schema.rolePickerEvent.action} = ${RolePickerAction.granted} THEN 1 WHEN ${schema.rolePickerEvent.action} = ${RolePickerAction.revoked} THEN -1 ELSE 0 END) > 0`,
      );
    const currentlyHeld = new Set<string>();
    for (const row of heldRows) {
      if (row.optionId !== null) currentlyHeld.add(row.optionId);
    }

    // Diff. Grants first so the user gains the new role before losing
    // the old — if both pass, the swap is atomic from the user's POV.
    // Failures on grant don't block subsequent revokes; failures on
    // revoke don't roll back successful grants. Each role-op is its
    // own audit row.
    const toGrantIds = Array.from(selectedSet).filter((id) => !currentlyHeld.has(id));
    const toRevokeIds = Array.from(currentlyHeld).filter((id) => !selectedSet.has(id));

    // Pre-load any to-revoke options that aren't already in the
    // selected set (their rows are in `panel.options` but the snapshot
    // we want lives on the option, so we already have them).
    const optionForRevoke = new Map<string, RolePickerOption>();
    for (const id of toRevokeIds) {
      const opt = optionsById.get(id);
      if (opt !== undefined) optionForRevoke.set(id, opt);
    }
    // Some revoked options may have been deleted; load them by id (FK
    // SET NULL only kicks in for events, not the option row). If still
    // missing, fall back to the audit-log snapshot (handled below).
    const missingRevokeIds = toRevokeIds.filter((id) => !optionForRevoke.has(id));
    if (missingRevokeIds.length > 0) {
      const rows = await this.db
        .select()
        .from(schema.rolePickerOption)
        .where(inArray(schema.rolePickerOption.id, missingRevokeIds));
      for (const row of rows) {
        optionForRevoke.set(row.id, row);
      }
    }

    let grantedCount = 0;
    let revokedCount = 0;
    let failedCount = 0;
    const grantedLabels: string[] = [];
    const revokedLabels: string[] = [];

    for (const optionId of toGrantIds) {
      const option = optionsById.get(optionId);
      if (option === undefined) continue;
      const outcome = await this.tryGrant(panel, option, input.userId);
      if (outcome === RolePickerAction.granted) {
        grantedCount += 1;
        grantedLabels.push(option.label);
      } else {
        failedCount += 1;
      }
    }

    for (const optionId of toRevokeIds) {
      const option = optionForRevoke.get(optionId);
      if (option === undefined) continue;
      const outcome = await this.tryRevoke(panel, option, input.userId);
      if (outcome === RolePickerAction.revoked) {
        revokedCount += 1;
        revokedLabels.push(option.label);
      } else {
        failedCount += 1;
      }
    }

    return ok({
      grantedCount,
      revokedCount,
      failedCount,
      grantedLabels,
      revokedLabels,
    });
  }

  // ─────────────────────────── audit ───────────────────────────

  public async listEvents(panelId: string, limit = 50): Promise<RolePickerEvent[]> {
    return await this.db
      .select()
      .from(schema.rolePickerEvent)
      .where(eq(schema.rolePickerEvent.panelId, panelId))
      .orderBy(asc(schema.rolePickerEvent.createdAt))
      .limit(limit);
  }

  public async countEvents(panelId: string): Promise<number> {
    const [row] = await this.db
      .select({ value: count() })
      .from(schema.rolePickerEvent)
      .where(eq(schema.rolePickerEvent.panelId, panelId));
    return row?.value ?? 0;
  }

  // ─────────────────────────── private ───────────────────────────

  private async tryGrant(
    panel: RolePickerPanel,
    option: RolePickerOption,
    userId: string,
  ): Promise<RolePickerAction> {
    try {
      await this.gateway.assignRoleToMember(panel.guildId, userId, option.roleId);
    } catch (error) {
      if (error instanceof DiscordApiError) {
        await this.recordEvent(panel.id, userId, option, RolePickerAction.roleAssignFailed);
        return RolePickerAction.roleAssignFailed;
      }
      throw error;
    }
    await this.recordEvent(panel.id, userId, option, RolePickerAction.granted);
    return RolePickerAction.granted;
  }

  private async tryRevoke(
    panel: RolePickerPanel,
    option: RolePickerOption,
    userId: string,
  ): Promise<RolePickerAction> {
    try {
      await this.gateway.removeRoleFromMember(panel.guildId, userId, option.roleId);
    } catch (error) {
      if (error instanceof DiscordApiError) {
        await this.recordEvent(panel.id, userId, option, RolePickerAction.roleRevokeFailed);
        return RolePickerAction.roleRevokeFailed;
      }
      throw error;
    }
    await this.recordEvent(panel.id, userId, option, RolePickerAction.revoked);
    return RolePickerAction.revoked;
  }

  /**
   * Record an audit event. Snapshots option label / emoji / roleId
   * onto the row so post-delete reads still answer "what did the user
   * pick" (FK on optionId is ON DELETE SET NULL).
   */
  private async recordEvent(
    panelId: string,
    userId: string,
    option: Pick<RolePickerOption, 'id' | 'label' | 'emoji' | 'roleId'>,
    action: RolePickerAction,
  ): Promise<void> {
    await this.db.insert(schema.rolePickerEvent).values({
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

function emptyResult(): RolePickerSelectionResult {
  return {
    grantedCount: 0,
    revokedCount: 0,
    failedCount: 0,
    grantedLabels: [],
    revokedLabels: [],
  };
}
