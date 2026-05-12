import type {
  DbDrizzle,
  ReactionRolesEvent,
  ReactionRolesOption,
  ReactionRolesPanel,
} from '@hearth/database';
import type {
  AppError,
  ConflictError,
  NotFoundError,
  Result,
  ValidationError,
} from '@hearth/shared';
import type { Branding, ReactionRolesGateway } from '@hearth/tickets-core';

import {
  type ReactionRolesCreateResult,
  type ReactionRolesOptionEditInput,
  type ReactionRolesOptionInput,
  type ReactionRolesPanelEditInput,
  type ReactionRolesPanelInput,
  type ReactionRolesPanelWithOptions,
  type ReactionRolesReactionResult,
} from './operations/_shared.js';
import { ReactionRolesOptionOperations } from './operations/optionOperations.js';
import { ReactionRolesPanelOperations } from './operations/panelOperations.js';
import { ReactionRolesReactionOperations } from './operations/reactionOperations.js';

// Public facade. Composes three single-responsibility operation
// classes (panel, option, reaction). Callers — bot container,
// dashboard server actions, internal-api routes — keep the existing
// flat method names so this is a pure internal refactor, not an API
// change.
//
// Why split:
//   - The previous 660-line class mixed four concerns (panel CRUD,
//     option CRUD, reaction handling, audit reads). Each grew its
//     own private helpers (findPanel, findOption, rerenderPanel,
//     lookupPanelAndOption, recordEvent) that had to be ordered by
//     dependency in one file.
//   - Splitting moves each concern's private helpers next to its
//     public surface. Reading panel logic no longer means scrolling
//     past reaction handlers.
//   - Each operation class is independently mockable for future
//     tests that want to assert across boundaries.
//
// Why a facade rather than three separate services in the public API:
//   - Every bot listener, internal-api route, and dashboard action
//     already imports `services.reactionRoles.X`. Renaming N callers
//     across two apps is churn with no observable benefit. The
//     facade keeps them stable.

export type {
  ReactionRolesCreateResult,
  ReactionRolesOptionEditInput,
  ReactionRolesOptionInput,
  ReactionRolesPanelEditInput,
  ReactionRolesPanelInput,
  ReactionRolesPanelWithOptions,
  ReactionRolesReactionResult,
};

export class ReactionRolesService {
  private readonly panelOps: ReactionRolesPanelOperations;
  private readonly optionOps: ReactionRolesOptionOperations;
  private readonly reactionOps: ReactionRolesReactionOperations;

  public constructor(db: DbDrizzle, gateway: ReactionRolesGateway, branding: Branding) {
    this.panelOps = new ReactionRolesPanelOperations(db, gateway, branding);
    this.optionOps = new ReactionRolesOptionOperations(db, gateway);
    this.reactionOps = new ReactionRolesReactionOperations(db, gateway);
  }

  // ─── panel surface ──────────────────────────────────────────────

  public createPanel(
    input: ReactionRolesPanelInput,
  ): Promise<Result<ReactionRolesCreateResult, ConflictError | ValidationError>> {
    return this.panelOps.createPanel(input);
  }

  public editPanel(
    panelId: string,
    input: ReactionRolesPanelEditInput,
  ): Promise<Result<ReactionRolesPanel, NotFoundError>> {
    return this.panelOps.editPanel(panelId, input);
  }

  public listPanels(guildId: string): Promise<ReactionRolesPanelWithOptions[]> {
    return this.panelOps.listPanels(guildId);
  }

  public getPanel(panelId: string): Promise<Result<ReactionRolesPanelWithOptions, NotFoundError>> {
    return this.panelOps.getPanel(panelId);
  }

  public renderPanel(
    panelId: string,
  ): Promise<Result<{ messageId: string; recreated: boolean }, NotFoundError>> {
    return this.panelOps.renderPanel(panelId);
  }

  public repostPanel(
    panelId: string,
  ): Promise<Result<{ messageId: string; previousMessageId: string }, NotFoundError>> {
    return this.panelOps.repostPanel(panelId);
  }

  public deletePanel(panelId: string): Promise<Result<{ panelId: string }, NotFoundError>> {
    return this.panelOps.deletePanel(panelId);
  }

  // ─── option surface ─────────────────────────────────────────────

  public addOption(
    panelId: string,
    input: ReactionRolesOptionInput,
  ): Promise<Result<ReactionRolesOption, ConflictError | NotFoundError | ValidationError>> {
    return this.optionOps.addOption(panelId, input);
  }

  public editOption(
    optionId: string,
    input: ReactionRolesOptionEditInput,
  ): Promise<Result<ReactionRolesOption, ConflictError | NotFoundError | ValidationError>> {
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

  // ─── reaction + audit surface ───────────────────────────────────

  public handleReactionAdd(input: {
    readonly messageId: string;
    readonly emoji: string;
    readonly userId: string;
    readonly guildId: string;
  }): Promise<Result<ReactionRolesReactionResult, AppError>> {
    return this.reactionOps.handleReactionAdd(input);
  }

  public handleReactionRemove(input: {
    readonly messageId: string;
    readonly emoji: string;
    readonly userId: string;
    readonly guildId: string;
  }): Promise<Result<ReactionRolesReactionResult, AppError>> {
    return this.reactionOps.handleReactionRemove(input);
  }

  public listEvents(panelId: string, limit?: number): Promise<ReactionRolesEvent[]> {
    return this.reactionOps.listEvents(panelId, limit);
  }

  public countEvents(panelId: string): Promise<number> {
    return this.reactionOps.countEvents(panelId);
  }
}
