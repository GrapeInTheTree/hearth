import { and, asc, type DbDrizzle, eq, type RolePickerPanel, schema } from '@hearth/database';
import {
  ConflictError,
  err,
  NotFoundError,
  ok,
  type Result,
  ValidationError,
} from '@hearth/shared';
import type { Branding, RolePickerGateway } from '@hearth/tickets-core';
import { createId } from '@paralleldrive/cuid2';

import { rolePicker as i18n } from '../i18n/index.js';
import { buildRolePickerCustomId } from '../lib/customIdHelpers.js';
import { buildRolePickerPayload } from '../lib/rolePickerBuilder.js';

import {
  DEFAULT_MAX_VALUES,
  DEFAULT_MIN_VALUES,
  DEFAULT_SELECTION_MODE,
  PLACEHOLDER_MESSAGE_ID,
  type RolePickerCreateResult,
  type RolePickerPanelEditInput,
  type RolePickerPanelInput,
  type RolePickerPanelWithOptions,
  sortOptions,
} from './_shared.js';

// Panel-shaped operations: CRUD + render + repost + delete. The
// renderPanel helper bridges DB state to Discord (send / edit /
// delete). The component row carrying the dropdown is part of the
// payload, so there's no separate reaction-sync step.

export class RolePickerPanelOperations {
  public constructor(
    private readonly db: DbDrizzle,
    private readonly gateway: RolePickerGateway,
    private readonly branding: Branding,
  ) {}

  /**
   * Create a new role-picker panel with no options. The customId is
   * generated upfront from a pre-allocated panel id so the StringSelectMenu
   * carries a stable identity from the very first render.
   */
  public async createPanel(
    input: RolePickerPanelInput,
  ): Promise<Result<RolePickerCreateResult, ConflictError | ValidationError>> {
    const embedTitle = input.embedTitle ?? i18n.panel.defaultEmbedTitle;
    const embedDescription = input.embedDescription ?? i18n.panel.defaultEmbedDescription;
    const placeholder = input.placeholder ?? i18n.panel.defaultPlaceholder;
    const selectionMode = input.selectionMode ?? DEFAULT_SELECTION_MODE;
    const minValues = input.minValues ?? DEFAULT_MIN_VALUES;
    const maxValues = input.maxValues ?? DEFAULT_MAX_VALUES;

    const placeholderInUse = await this.db.query.rolePickerPanel.findFirst({
      where: and(
        eq(schema.rolePickerPanel.guildId, input.guildId),
        eq(schema.rolePickerPanel.channelId, input.channelId),
        eq(schema.rolePickerPanel.messageId, PLACEHOLDER_MESSAGE_ID),
      ),
    });
    if (placeholderInUse !== undefined) {
      return err(
        new ConflictError(
          'A role-picker panel is already pending publish on this channel. Repost or delete it first.',
        ),
      );
    }

    // Pre-allocate the panel id so customId is computable at insert time.
    // Stored on the row + reused on every render — never re-encoded.
    const panelId = createId();
    const customId = buildRolePickerCustomId(panelId);

    const [created] = await this.db
      .insert(schema.rolePickerPanel)
      .values({
        id: panelId,
        guildId: input.guildId,
        channelId: input.channelId,
        messageId: PLACEHOLDER_MESSAGE_ID,
        embedTitle,
        embedDescription,
        placeholder,
        selectionMode,
        minValues,
        maxValues,
        customId,
      })
      .returning();
    if (created === undefined) {
      throw new Error('Failed to insert RolePickerPanel row');
    }
    return ok({ panel: created, created: true });
  }

  public async editPanel(
    panelId: string,
    input: RolePickerPanelEditInput,
  ): Promise<Result<RolePickerPanel, NotFoundError>> {
    const existing = await this.findPanel(panelId);
    if (existing === undefined) {
      return err(new NotFoundError(i18n.errors.panelNotFound));
    }
    const updates: Partial<typeof schema.rolePickerPanel.$inferInsert> = {};
    if (input.channelId !== undefined) updates.channelId = input.channelId;
    if (input.embedTitle !== undefined) updates.embedTitle = input.embedTitle;
    if (input.embedDescription !== undefined) updates.embedDescription = input.embedDescription;
    if (input.placeholder !== undefined) updates.placeholder = input.placeholder;
    if (input.selectionMode !== undefined) updates.selectionMode = input.selectionMode;
    if (input.minValues !== undefined) updates.minValues = input.minValues;
    if (input.maxValues !== undefined) updates.maxValues = input.maxValues;
    if (Object.keys(updates).length === 0) return ok(existing);
    const [updated] = await this.db
      .update(schema.rolePickerPanel)
      .set(updates)
      .where(eq(schema.rolePickerPanel.id, panelId))
      .returning();
    if (updated === undefined) {
      return err(new NotFoundError(i18n.errors.panelNotFound));
    }
    return ok(updated);
  }

  public async listPanels(guildId: string): Promise<RolePickerPanelWithOptions[]> {
    const rows = await this.db.query.rolePickerPanel.findMany({
      where: eq(schema.rolePickerPanel.guildId, guildId),
      with: { options: true },
      orderBy: [asc(schema.rolePickerPanel.createdAt)],
    });
    return rows.map((r) => ({ ...r, options: sortOptions(r.options) }));
  }

  public async getPanel(
    panelId: string,
  ): Promise<Result<RolePickerPanelWithOptions, NotFoundError>> {
    const row = await this.db.query.rolePickerPanel.findFirst({
      where: eq(schema.rolePickerPanel.id, panelId),
      with: { options: true },
    });
    if (row === undefined) return err(new NotFoundError(i18n.errors.panelNotFound));
    return ok({ ...row, options: sortOptions(row.options) });
  }

  /**
   * Re-render the panel's Discord message from current DB state. The
   * dashboard internal-API hook calls this after every CRUD mutation.
   * If the live message has been deleted, the edit path falls through
   * to a fresh send.
   *
   * Returns a ValidationError if the panel has no options — Discord
   * rejects empty StringSelectMenu components with 50035, so we catch
   * before the round-trip.
   */
  public async renderPanel(
    panelId: string,
  ): Promise<Result<{ messageId: string; recreated: boolean }, NotFoundError | ValidationError>> {
    const panelResult = await this.getPanel(panelId);
    if (!panelResult.ok) return panelResult;
    const panel = panelResult.value;
    if (panel.options.length === 0) {
      return err(new ValidationError(i18n.errors.optionsRequired));
    }
    const result = await this.rerenderPanel(panel);
    return ok(result);
  }

  /**
   * Drop the existing message and post a fresh one with the same DB
   * state. Existing role grants on members stay intact — role-picker
   * doesn't auto-revoke on repost.
   */
  public async repostPanel(
    panelId: string,
  ): Promise<
    Result<{ messageId: string; previousMessageId: string }, NotFoundError | ValidationError>
  > {
    const panelResult = await this.getPanel(panelId);
    if (!panelResult.ok) return panelResult;
    const panel = panelResult.value;
    if (panel.options.length === 0) {
      return err(new ValidationError(i18n.errors.optionsRequired));
    }
    const previousMessageId = panel.messageId;
    if (previousMessageId !== PLACEHOLDER_MESSAGE_ID) {
      await this.gateway.deleteRolePickerMessage(panel.channelId, previousMessageId);
    }
    const payload = buildRolePickerPayload(panel, panel.options, this.branding);
    const { messageId } = await this.gateway.sendRolePickerMessage(panel.channelId, payload);
    await this.db
      .update(schema.rolePickerPanel)
      .set({ messageId })
      .where(eq(schema.rolePickerPanel.id, panel.id));
    return ok({ messageId, previousMessageId });
  }

  /**
   * Hard-delete a panel: blank-out the live message (so any in-flight
   * submission has nothing to bind to), delete it, and remove the DB
   * row. Cascades to RolePickerOption + RolePickerEvent via FK.
   */
  public async deletePanel(panelId: string): Promise<Result<{ panelId: string }, NotFoundError>> {
    const panel = await this.findPanel(panelId);
    if (panel === undefined) return err(new NotFoundError(i18n.errors.panelNotFound));
    if (panel.messageId !== PLACEHOLDER_MESSAGE_ID) {
      await this.gateway
        .editRolePickerMessage(panel.channelId, panel.messageId, {
          content: undefined,
          embeds: [],
          components: [],
        })
        .catch(() => undefined);
      await this.gateway
        .deleteRolePickerMessage(panel.channelId, panel.messageId)
        .catch(() => undefined);
    }
    await this.db.delete(schema.rolePickerPanel).where(eq(schema.rolePickerPanel.id, panelId));
    return ok({ panelId });
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

  private async rerenderPanel(
    panel: RolePickerPanelWithOptions,
  ): Promise<{ messageId: string; recreated: boolean }> {
    const payload = buildRolePickerPayload(panel, panel.options, this.branding);
    if (panel.messageId === PLACEHOLDER_MESSAGE_ID) {
      const { messageId } = await this.gateway.sendRolePickerMessage(panel.channelId, payload);
      await this.db
        .update(schema.rolePickerPanel)
        .set({ messageId })
        .where(eq(schema.rolePickerPanel.id, panel.id));
      return { messageId, recreated: true };
    }
    try {
      await this.gateway.editRolePickerMessage(panel.channelId, panel.messageId, payload);
      return { messageId: panel.messageId, recreated: false };
    } catch {
      // Live message gone — recreate.
      const { messageId } = await this.gateway.sendRolePickerMessage(panel.channelId, payload);
      await this.db
        .update(schema.rolePickerPanel)
        .set({ messageId })
        .where(eq(schema.rolePickerPanel.id, panel.id));
      return { messageId, recreated: true };
    }
  }
}
