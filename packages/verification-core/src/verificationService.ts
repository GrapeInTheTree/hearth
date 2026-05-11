import {
  and,
  asc,
  count,
  type DbDrizzle,
  eq,
  schema,
  type VerificationEvent,
  type VerificationOption,
  VerificationOutcome,
  type VerificationPanel,
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
import type { Branding, VerificationGateway } from '@hearth/tickets-core';

import { verification as i18n } from './i18n/index.js';
import { buildVerificationPayload } from './lib/verificationBuilder.js';

const PLACEHOLDER_MESSAGE_ID = 'pending';
const MAX_OPTIONS_PER_PANEL = 5;

export interface VerificationPanelInput {
  readonly guildId: string;
  readonly channelId: string;
  /** Operator-supplied embed title; falls back to i18n default. */
  readonly embedTitle?: string;
  /** Operator-supplied embed description; falls back to i18n default. */
  readonly embedDescription?: string;
  readonly roleId: string;
}

export interface VerificationPanelEditInput {
  readonly channelId?: string;
  readonly embedTitle?: string;
  readonly embedDescription?: string;
  readonly roleId?: string;
}

export interface VerificationOptionInput {
  readonly label: string;
  readonly emoji: string;
  readonly buttonStyle: 'primary' | 'secondary' | 'success' | 'danger';
  readonly position: number;
}

export interface VerificationOptionEditInput {
  readonly label?: string;
  readonly emoji?: string;
  readonly buttonStyle?: 'primary' | 'secondary' | 'success' | 'danger';
  readonly position?: number;
}

export interface VerificationPanelWithOptions extends VerificationPanel {
  readonly options: VerificationOption[];
}

export interface VerificationCreateResult {
  readonly panel: VerificationPanel;
  readonly created: boolean;
}

export interface VerificationSubmissionResult {
  readonly outcome: VerificationOutcome;
  readonly roleId?: string;
}

/**
 * Verification panels live in a single channel each, host up to 5 emoji
 * buttons, and grant a single configured role when a user clicks the
 * "correct" option. Lifecycle (create → add options → set correct →
 * publish/repost) mirrors the panel/ticket-types lifecycle.
 *
 * Order of operations on create / add: persist DB first, render Discord
 * after — service stores the bot's chosen messageId back on the row so a
 * mid-flow Discord failure leaves the panel/options intact for a /repost
 * retry. correctOptionId is left NULL until the operator explicitly sets
 * it; render is rejected until then.
 */
export class VerificationService {
  public constructor(
    private readonly db: DbDrizzle,
    private readonly gateway: VerificationGateway,
    private readonly branding: Branding,
  ) {}

  // ─────────────────────────── panel ───────────────────────────

  /**
   * Create a new verification panel with no options. Operator must add
   * options + set-correct + repost before clicks become useful. Two panels
   * can coexist in the same channel only after the first one has been
   * published with a real messageId — the (guildId, channelId, messageId)
   * unique index would otherwise reject the second placeholder.
   */
  public async createPanel(
    input: VerificationPanelInput,
  ): Promise<Result<VerificationCreateResult, ConflictError | ValidationError>> {
    const embedTitle = input.embedTitle ?? i18n.panel.defaultEmbedTitle;
    const embedDescription = input.embedDescription ?? i18n.panel.defaultEmbedDescription;

    const placeholderInUse = await this.db.query.verificationPanel.findFirst({
      where: and(
        eq(schema.verificationPanel.guildId, input.guildId),
        eq(schema.verificationPanel.channelId, input.channelId),
        eq(schema.verificationPanel.messageId, PLACEHOLDER_MESSAGE_ID),
      ),
    });
    if (placeholderInUse !== undefined) {
      return err(
        new ConflictError(
          'A verification panel is already pending publish on this channel. Repost or delete it first.',
        ),
      );
    }

    const [created] = await this.db
      .insert(schema.verificationPanel)
      .values({
        guildId: input.guildId,
        channelId: input.channelId,
        messageId: PLACEHOLDER_MESSAGE_ID,
        embedTitle,
        embedDescription,
        roleId: input.roleId,
      })
      .returning();
    if (created === undefined) {
      throw new Error('Failed to insert VerificationPanel row');
    }
    return ok({ panel: created, created: true });
  }

  public async editPanel(
    panelId: string,
    input: VerificationPanelEditInput,
  ): Promise<Result<VerificationPanel, NotFoundError>> {
    const existing = await this.findPanel(panelId);
    if (existing === undefined) {
      return err(new NotFoundError(i18n.errors.panelNotFound));
    }
    const updates: Partial<typeof schema.verificationPanel.$inferInsert> = {};
    if (input.channelId !== undefined) updates.channelId = input.channelId;
    if (input.embedTitle !== undefined) updates.embedTitle = input.embedTitle;
    if (input.embedDescription !== undefined) updates.embedDescription = input.embedDescription;
    if (input.roleId !== undefined) updates.roleId = input.roleId;
    if (Object.keys(updates).length === 0) return ok(existing);
    const [updated] = await this.db
      .update(schema.verificationPanel)
      .set(updates)
      .where(eq(schema.verificationPanel.id, panelId))
      .returning();
    if (updated === undefined) {
      return err(new NotFoundError(i18n.errors.panelNotFound));
    }
    return ok(updated);
  }

  public async listPanels(guildId: string): Promise<VerificationPanelWithOptions[]> {
    const rows = await this.db.query.verificationPanel.findMany({
      where: eq(schema.verificationPanel.guildId, guildId),
      with: { options: true },
      orderBy: [asc(schema.verificationPanel.createdAt)],
    });
    return rows.map((r) => ({ ...r, options: sortOptions(r.options) }));
  }

  public async getPanel(
    panelId: string,
  ): Promise<Result<VerificationPanelWithOptions, NotFoundError>> {
    const row = await this.db.query.verificationPanel.findFirst({
      where: eq(schema.verificationPanel.id, panelId),
      with: { options: true },
    });
    if (row === undefined) return err(new NotFoundError(i18n.errors.panelNotFound));
    return ok({ ...row, options: sortOptions(row.options) });
  }

  /**
   * Re-render the panel's Discord message from current DB state. Idempotent.
   * Used by the dashboard's internal-API hook after CRUD-style mutations.
   * Rejects with ConflictError when the panel has options but no correct
   * option chosen — publishing a panel with no correct answer would let
   * any click silently fail-by-design, which is worse than a clear error.
   */
  public async renderPanel(
    panelId: string,
  ): Promise<Result<{ messageId: string; recreated: boolean }, NotFoundError | ConflictError>> {
    const panelResult = await this.getPanel(panelId);
    if (!panelResult.ok) return panelResult;
    const panel = panelResult.value;
    if (panel.options.length > 0 && panel.correctOptionId === null) {
      return err(new ConflictError(i18n.errors.correctOptionNotSet));
    }
    const result = await this.rerenderPanel(panel);
    return ok(result);
  }

  /**
   * Drop the existing message and post a fresh one with the same DB state.
   * Channel position resets to bottom — useful when the panel scrolled out
   * of sight after channel activity. Buttons keep working immediately
   * because the customId encodes (panelId, optionId), not messageId.
   */
  public async repostPanel(
    panelId: string,
  ): Promise<
    Result<{ messageId: string; previousMessageId: string }, NotFoundError | ConflictError>
  > {
    const panelResult = await this.getPanel(panelId);
    if (!panelResult.ok) return panelResult;
    const panel = panelResult.value;
    if (panel.options.length > 0 && panel.correctOptionId === null) {
      return err(new ConflictError(i18n.errors.correctOptionNotSet));
    }
    const previousMessageId = panel.messageId;
    if (previousMessageId !== PLACEHOLDER_MESSAGE_ID) {
      // Best-effort delete — the djs gateway swallows 404 so already-gone
      // messages don't fail the flow.
      await this.gateway.deleteVerificationMessage(panel.channelId, previousMessageId);
    }
    const payload = buildVerificationPayload(panel, panel.options, this.branding);
    const { messageId } = await this.gateway.sendVerificationMessage(panel.channelId, payload);
    await this.db
      .update(schema.verificationPanel)
      .set({ messageId })
      .where(eq(schema.verificationPanel.id, panel.id));
    return ok({ messageId, previousMessageId });
  }

  /**
   * Hard-delete a panel: remove its Discord message (best-effort, blanks
   * embeds + components first to avoid race with users mid-click) and the
   * DB row. Cascades to VerificationOption + VerificationEvent via FK.
   */
  public async deletePanel(panelId: string): Promise<Result<{ panelId: string }, NotFoundError>> {
    const panel = await this.findPanel(panelId);
    if (panel === undefined) return err(new NotFoundError(i18n.errors.panelNotFound));
    if (panel.messageId !== PLACEHOLDER_MESSAGE_ID) {
      // Best-effort blank-out so any in-flight click sees an empty message.
      await this.gateway
        .editVerificationMessage(panel.channelId, panel.messageId, {
          content: undefined,
          embeds: [],
          components: [],
        })
        .catch(() => undefined);
      await this.gateway
        .deleteVerificationMessage(panel.channelId, panel.messageId)
        .catch(() => undefined);
    }
    await this.db.delete(schema.verificationPanel).where(eq(schema.verificationPanel.id, panelId));
    return ok({ panelId });
  }

  // ─────────────────────────── options ───────────────────────────

  public async addOption(
    panelId: string,
    input: VerificationOptionInput,
  ): Promise<Result<VerificationOption, ConflictError | NotFoundError | ValidationError>> {
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
    const [created] = await this.db
      .insert(schema.verificationOption)
      .values({
        panelId,
        label: input.label,
        emoji: input.emoji,
        buttonStyle: input.buttonStyle,
        position: input.position,
      })
      .returning();
    if (created === undefined) {
      throw new Error('Failed to insert VerificationOption');
    }
    return ok(created);
  }

  public async editOption(
    optionId: string,
    input: VerificationOptionEditInput,
  ): Promise<Result<VerificationOption, ConflictError | NotFoundError | ValidationError>> {
    const existing = await this.findOption(optionId);
    if (existing === undefined) return err(new NotFoundError(i18n.errors.optionNotFound));

    if (input.position !== undefined) {
      if (input.position < 0 || input.position > MAX_OPTIONS_PER_PANEL - 1) {
        return err(new ValidationError(i18n.errors.invalidPosition));
      }
    }

    // Sibling collision checks — only the columns the operator is changing.
    if (input.label !== undefined && input.label !== existing.label) {
      const dupLabel = await this.db.query.verificationOption.findFirst({
        where: and(
          eq(schema.verificationOption.panelId, existing.panelId),
          eq(schema.verificationOption.label, input.label),
        ),
      });
      if (dupLabel !== undefined && dupLabel.id !== existing.id) {
        return err(new ConflictError(i18n.errors.duplicateLabel));
      }
    }
    if (input.position !== undefined && input.position !== existing.position) {
      const dupPosition = await this.db.query.verificationOption.findFirst({
        where: and(
          eq(schema.verificationOption.panelId, existing.panelId),
          eq(schema.verificationOption.position, input.position),
        ),
      });
      if (dupPosition !== undefined && dupPosition.id !== existing.id) {
        return err(new ConflictError(i18n.errors.duplicatePosition));
      }
    }

    const updates: Partial<typeof schema.verificationOption.$inferInsert> = {};
    if (input.label !== undefined) updates.label = input.label;
    if (input.emoji !== undefined) updates.emoji = input.emoji;
    if (input.buttonStyle !== undefined) updates.buttonStyle = input.buttonStyle;
    if (input.position !== undefined) updates.position = input.position;

    if (Object.keys(updates).length === 0) return ok(existing);

    const [updated] = await this.db
      .update(schema.verificationOption)
      .set(updates)
      .where(eq(schema.verificationOption.id, optionId))
      .returning();
    if (updated === undefined) return err(new NotFoundError(i18n.errors.optionNotFound));
    return ok(updated);
  }

  public async removeOption(
    optionId: string,
  ): Promise<Result<{ removedId: string }, ConflictError | NotFoundError>> {
    const existing = await this.findOption(optionId);
    if (existing === undefined) return err(new NotFoundError(i18n.errors.optionNotFound));
    const panel = await this.findPanel(existing.panelId);
    if (panel === undefined) return err(new NotFoundError(i18n.errors.panelNotFound));
    if (panel.correctOptionId === optionId) {
      return err(new ConflictError(i18n.errors.cannotRemoveCorrect));
    }
    await this.db
      .delete(schema.verificationOption)
      .where(eq(schema.verificationOption.id, optionId));
    return ok({ removedId: optionId });
  }

  public async setCorrectOption(
    panelId: string,
    optionId: string,
  ): Promise<Result<VerificationPanel, NotFoundError | ValidationError>> {
    const option = await this.findOption(optionId);
    if (option === undefined) return err(new NotFoundError(i18n.errors.optionNotFound));
    if (option.panelId !== panelId) {
      return err(new ValidationError(i18n.errors.optionFromOtherPanel));
    }
    const [updated] = await this.db
      .update(schema.verificationPanel)
      .set({ correctOptionId: optionId })
      .where(eq(schema.verificationPanel.id, panelId))
      .returning();
    if (updated === undefined) return err(new NotFoundError(i18n.errors.panelNotFound));
    return ok(updated);
  }

  // ────────────────────── submission (button click) ──────────────────────

  /**
   * Process a click on a verification button.
   *  ① Wrong option → record('wrong_answer'), return.
   *  ② Already has the role → record('already_verified'), return.
   *  ③ Try to assign the role:
   *      - DiscordApiError → record('role_assign_failed').
   *      - Success → record('success').
   *
   * The DB write (event) and Discord write (assignRole) are sequential
   * but not transactional. A successful assign followed by an event-write
   * crash is the only "lost audit" path; production logs would still
   * carry the granted role event from Discord's audit log. Keeping this
   * non-transactional avoids holding a long-running tx open while
   * Discord's REST call (1-3s) lands.
   */
  public async handleSubmission(input: {
    readonly panelId: string;
    readonly optionId: string;
    readonly userId: string;
  }): Promise<Result<VerificationSubmissionResult, NotFoundError | AppError>> {
    const panel = await this.findPanel(input.panelId);
    if (panel === undefined) return err(new NotFoundError(i18n.errors.panelNotFound));
    const option = await this.findOption(input.optionId);
    if (option === undefined || option.panelId !== input.panelId) {
      return err(new NotFoundError(i18n.errors.optionNotFound));
    }

    if (panel.correctOptionId !== input.optionId) {
      await this.recordEvent(panel.id, input.userId, option.id, VerificationOutcome.wrongAnswer);
      return ok({ outcome: VerificationOutcome.wrongAnswer });
    }

    const alreadyHasRole = await this.gateway.memberHasRole(
      panel.guildId,
      input.userId,
      panel.roleId,
    );
    if (alreadyHasRole) {
      await this.recordEvent(
        panel.id,
        input.userId,
        option.id,
        VerificationOutcome.alreadyVerified,
      );
      return ok({ outcome: VerificationOutcome.alreadyVerified, roleId: panel.roleId });
    }

    try {
      await this.gateway.assignRoleToMember(panel.guildId, input.userId, panel.roleId);
    } catch (error) {
      if (error instanceof DiscordApiError) {
        await this.recordEvent(
          panel.id,
          input.userId,
          option.id,
          VerificationOutcome.roleAssignFailed,
        );
        return ok({ outcome: VerificationOutcome.roleAssignFailed });
      }
      throw error;
    }

    await this.recordEvent(panel.id, input.userId, option.id, VerificationOutcome.success);
    return ok({ outcome: VerificationOutcome.success, roleId: panel.roleId });
  }

  // ─────────────────────────── audit ───────────────────────────

  public async listEvents(panelId: string, limit = 50): Promise<VerificationEvent[]> {
    return await this.db
      .select()
      .from(schema.verificationEvent)
      .where(eq(schema.verificationEvent.panelId, panelId))
      .orderBy(asc(schema.verificationEvent.createdAt))
      .limit(limit);
  }

  public async countEvents(panelId: string): Promise<number> {
    const [row] = await this.db
      .select({ value: count() })
      .from(schema.verificationEvent)
      .where(eq(schema.verificationEvent.panelId, panelId));
    return row?.value ?? 0;
  }

  // ─────────────────────────── private ───────────────────────────

  private async findPanel(panelId: string): Promise<VerificationPanel | undefined> {
    const [row] = await this.db
      .select()
      .from(schema.verificationPanel)
      .where(eq(schema.verificationPanel.id, panelId))
      .limit(1);
    return row;
  }

  private async findPanelWithOptions(
    panelId: string,
  ): Promise<VerificationPanelWithOptions | undefined> {
    const row = await this.db.query.verificationPanel.findFirst({
      where: eq(schema.verificationPanel.id, panelId),
      with: { options: true },
    });
    if (row === undefined) return undefined;
    return { ...row, options: sortOptions(row.options) };
  }

  private async findOption(optionId: string): Promise<VerificationOption | undefined> {
    const [row] = await this.db
      .select()
      .from(schema.verificationOption)
      .where(eq(schema.verificationOption.id, optionId))
      .limit(1);
    return row;
  }

  private async rerenderPanel(
    panel: VerificationPanelWithOptions,
  ): Promise<{ messageId: string; recreated: boolean }> {
    const payload = buildVerificationPayload(panel, panel.options, this.branding);
    if (panel.messageId === PLACEHOLDER_MESSAGE_ID) {
      const { messageId } = await this.gateway.sendVerificationMessage(panel.channelId, payload);
      await this.db
        .update(schema.verificationPanel)
        .set({ messageId })
        .where(eq(schema.verificationPanel.id, panel.id));
      return { messageId, recreated: true };
    }
    try {
      await this.gateway.editVerificationMessage(panel.channelId, panel.messageId, payload);
      return { messageId: panel.messageId, recreated: false };
    } catch {
      // Live message gone — recreate.
      const { messageId } = await this.gateway.sendVerificationMessage(panel.channelId, payload);
      await this.db
        .update(schema.verificationPanel)
        .set({ messageId })
        .where(eq(schema.verificationPanel.id, panel.id));
      return { messageId, recreated: true };
    }
  }

  private async recordEvent(
    panelId: string,
    userId: string,
    optionId: string,
    outcome: VerificationOutcome,
  ): Promise<void> {
    await this.db.insert(schema.verificationEvent).values({
      panelId,
      userId,
      optionId,
      outcome,
    });
  }
}

function sortOptions(options: readonly VerificationOption[]): VerificationOption[] {
  return [...options].sort((a, b) => a.position - b.position);
}
