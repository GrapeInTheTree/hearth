// Shared constants + types used by the three operation classes
// (panel, option, selection) that make up RolePickerService.

import type { RolePickerAction, RolePickerOption, RolePickerPanel } from '@hearth/database';

export const PLACEHOLDER_MESSAGE_ID = 'pending';
export const MAX_OPTIONS_PER_PANEL = 25;
export const DEFAULT_SELECTION_MODE = 'single';
export const DEFAULT_MIN_VALUES = 1;
export const DEFAULT_MAX_VALUES = 1;

export interface RolePickerPanelInput {
  readonly guildId: string;
  readonly channelId: string;
  /** Operator-supplied embed title; falls back to i18n default. */
  readonly embedTitle?: string;
  /** Operator-supplied embed description; falls back to i18n default. */
  readonly embedDescription?: string;
  /** Dropdown placeholder (shown when nothing selected). Falls back to default. */
  readonly placeholder?: string;
  /** v1 ships locked to 'single'. v2 will unlock 'multi'. */
  readonly selectionMode?: 'single' | 'multi';
  /** Discord's StringSelectMenu `min_values`. Defaults to 1. */
  readonly minValues?: number;
  /** Discord's StringSelectMenu `max_values`. Defaults to 1. */
  readonly maxValues?: number;
}

export interface RolePickerPanelEditInput {
  readonly channelId?: string;
  readonly embedTitle?: string;
  readonly embedDescription?: string;
  readonly placeholder?: string;
  readonly selectionMode?: 'single' | 'multi';
  readonly minValues?: number;
  readonly maxValues?: number;
}

export interface RolePickerOptionInput {
  readonly label: string;
  readonly description?: string;
  readonly emoji?: string;
  readonly roleId: string;
  readonly position: number;
}

export interface RolePickerOptionEditInput {
  readonly label?: string;
  readonly description?: string | null;
  readonly emoji?: string | null;
  readonly roleId?: string;
  readonly position?: number;
}

export interface RolePickerPanelWithOptions extends RolePickerPanel {
  readonly options: RolePickerOption[];
}

export interface RolePickerCreateResult {
  readonly panel: RolePickerPanel;
  readonly created: boolean;
}

/** Outcome of a single selection submission. The diff produced
 *  `grantedCount` new role grants and `revokedCount` revokes;
 *  `failedCount` is the number of role ops Discord rejected (split
 *  evenly across the two failure-variant audit rows). The label
 *  arrays carry the option labels involved so the ephemeral confirm
 *  can render "Added: English. Removed: Korean." style copy. */
export interface RolePickerSelectionResult {
  readonly grantedCount: number;
  readonly revokedCount: number;
  readonly failedCount: number;
  readonly grantedLabels: readonly string[];
  readonly revokedLabels: readonly string[];
}

export function sortOptions(options: readonly RolePickerOption[]): RolePickerOption[] {
  return [...options].sort((a, b) => a.position - b.position);
}

/** Action-key alias for use in the failure-mapping branches inside
 *  selectionOperations. Keeps imports flat. */
export type RolePickerActionKey = RolePickerAction;
