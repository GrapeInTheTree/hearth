// Shared constants + types used by the three operation classes
// (panel, option, reaction) that make up ReactionRolesService. Lives in
// _shared because the operation files are siblings — keeping the
// types here avoids any one of them becoming the de-facto base.

import type {
  ReactionRolesAction,
  ReactionRolesOption,
  ReactionRolesPanel,
} from '@hearth/database';

export const PLACEHOLDER_MESSAGE_ID = 'pending';
export const MAX_OPTIONS_PER_PANEL = 20;

export interface ReactionRolesPanelInput {
  readonly guildId: string;
  readonly channelId: string;
  /** Operator-supplied embed title; falls back to i18n default. */
  readonly embedTitle?: string;
  /** Operator-supplied embed description; falls back to i18n default. */
  readonly embedDescription?: string;
}

export interface ReactionRolesPanelEditInput {
  readonly channelId?: string;
  readonly embedTitle?: string;
  readonly embedDescription?: string;
}

export interface ReactionRolesOptionInput {
  readonly label: string;
  readonly emoji: string;
  readonly roleId: string;
  readonly position: number;
}

export interface ReactionRolesOptionEditInput {
  readonly label?: string;
  readonly emoji?: string;
  readonly roleId?: string;
  readonly position?: number;
}

export interface ReactionRolesPanelWithOptions extends ReactionRolesPanel {
  readonly options: ReactionRolesOption[];
}

export interface ReactionRolesCreateResult {
  readonly panel: ReactionRolesPanel;
  readonly created: boolean;
}

/** Outcome of a single reaction event. 'noop' covers anything that left
 *  the user's role state unchanged — Discord rejected the role op, or
 *  the reaction targeted a message/emoji the bot doesn't track. */
export interface ReactionRolesReactionResult {
  readonly action: ReactionRolesAction;
  readonly roleId?: string;
}

export function sortOptions(options: readonly ReactionRolesOption[]): ReactionRolesOption[] {
  return [...options].sort((a, b) => a.position - b.position);
}
