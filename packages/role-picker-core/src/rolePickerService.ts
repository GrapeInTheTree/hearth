import type {
  DbDrizzle,
  RolePickerEvent,
  RolePickerOption,
  RolePickerPanel,
} from '@hearth/database';
import type {
  AppError,
  ConflictError,
  NotFoundError,
  Result,
  ValidationError,
} from '@hearth/shared';
import type { Branding, RolePickerGateway } from '@hearth/tickets-core';

import {
  type RolePickerCreateResult,
  type RolePickerOptionEditInput,
  type RolePickerOptionInput,
  type RolePickerPanelEditInput,
  type RolePickerPanelInput,
  type RolePickerPanelWithOptions,
  type RolePickerSelectionResult,
} from './operations/_shared.js';
import { RolePickerOptionOperations } from './operations/optionOperations.js';
import { RolePickerPanelOperations } from './operations/panelOperations.js';
import { RolePickerSelectionOperations } from './operations/selectionOperations.js';

// Public facade. Composes three single-responsibility operation
// classes (panel, option, selection). Mirrors the verification-core /
// reaction-roles-core layout — callers (bot container, dashboard server
// actions, internal-api routes) use the flat method names.
//
// Why split:
//   - Panel CRUD + Discord send/edit/delete is one concern.
//   - Option CRUD + audit-log derived holder queries is another.
//   - StringSelectMenu submission + audit writes is a third, with its
//     own diff logic that the other two don't share.
//   - Each operation class is independently mockable.
//
// Why a facade rather than three public services: every caller already
// reaches for `services.rolePicker.X`. Splitting the public surface
// would churn imports across two apps for no observable benefit.

export type {
  RolePickerCreateResult,
  RolePickerOptionEditInput,
  RolePickerOptionInput,
  RolePickerPanelEditInput,
  RolePickerPanelInput,
  RolePickerPanelWithOptions,
  RolePickerSelectionResult,
};

export class RolePickerService {
  private readonly panelOps: RolePickerPanelOperations;
  private readonly optionOps: RolePickerOptionOperations;
  private readonly selectionOps: RolePickerSelectionOperations;

  public constructor(db: DbDrizzle, gateway: RolePickerGateway, branding: Branding) {
    this.panelOps = new RolePickerPanelOperations(db, gateway, branding);
    this.optionOps = new RolePickerOptionOperations(db, gateway);
    this.selectionOps = new RolePickerSelectionOperations(db, gateway);
  }

  // ─── panel surface ──────────────────────────────────────────────

  public createPanel(
    input: RolePickerPanelInput,
  ): Promise<Result<RolePickerCreateResult, ConflictError | ValidationError>> {
    return this.panelOps.createPanel(input);
  }

  public editPanel(
    panelId: string,
    input: RolePickerPanelEditInput,
  ): Promise<Result<RolePickerPanel, NotFoundError>> {
    return this.panelOps.editPanel(panelId, input);
  }

  public listPanels(guildId: string): Promise<RolePickerPanelWithOptions[]> {
    return this.panelOps.listPanels(guildId);
  }

  public getPanel(panelId: string): Promise<Result<RolePickerPanelWithOptions, NotFoundError>> {
    return this.panelOps.getPanel(panelId);
  }

  public renderPanel(
    panelId: string,
  ): Promise<Result<{ messageId: string; recreated: boolean }, NotFoundError | ValidationError>> {
    return this.panelOps.renderPanel(panelId);
  }

  public repostPanel(
    panelId: string,
  ): Promise<
    Result<{ messageId: string; previousMessageId: string }, NotFoundError | ValidationError>
  > {
    return this.panelOps.repostPanel(panelId);
  }

  public deletePanel(panelId: string): Promise<Result<{ panelId: string }, NotFoundError>> {
    return this.panelOps.deletePanel(panelId);
  }

  // ─── option surface ─────────────────────────────────────────────

  public addOption(
    panelId: string,
    input: RolePickerOptionInput,
  ): Promise<Result<RolePickerOption, ConflictError | NotFoundError | ValidationError>> {
    return this.optionOps.addOption(panelId, input);
  }

  public editOption(
    optionId: string,
    input: RolePickerOptionEditInput,
  ): Promise<Result<RolePickerOption, ConflictError | NotFoundError | ValidationError>> {
    return this.optionOps.editOption(optionId, input);
  }

  public removeOption(optionId: string): Promise<Result<{ removedId: string }, NotFoundError>> {
    return this.optionOps.removeOption(optionId);
  }

  public getOptionHolders(optionId: string): Promise<readonly string[]> {
    return this.optionOps.getOptionHolders(optionId);
  }

  public revokeRoleFromOptionHolders(
    optionId: string,
  ): Promise<Result<{ revokedCount: number }, NotFoundError>> {
    return this.optionOps.revokeRoleFromOptionHolders(optionId);
  }

  // ─── selection + audit surface ──────────────────────────────────

  public handleSelection(input: {
    readonly panelId: string;
    readonly userId: string;
    readonly selectedValues: readonly string[];
  }): Promise<Result<RolePickerSelectionResult, AppError>> {
    return this.selectionOps.handleSelection(input);
  }

  public listEvents(panelId: string, limit?: number): Promise<RolePickerEvent[]> {
    return this.selectionOps.listEvents(panelId, limit);
  }

  public countEvents(panelId: string): Promise<number> {
    return this.selectionOps.countEvents(panelId);
  }
}
