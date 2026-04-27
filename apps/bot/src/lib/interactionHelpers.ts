import { ConflictError, NotFoundError, PermissionError } from '@discord-bot/shared';
import { type Interaction, type ButtonInteraction, MessageFlags } from 'discord.js';

import { i18n } from '../i18n/index.js';

// Shared helpers for button + modal interaction handlers. Extracted because
// every lifecycle handler needs to (a) read the member's role IDs without
// committing to a discord.js shape (interaction.member can be GuildMember
// | APIInteractionGuildMember), and (b) map AppErrors to ephemeral i18n
// replies in a way that respects whether the interaction was already
// deferred.

/**
 * Pull the member's role-id list from a button interaction. Returns an empty
 * array if the interaction is somehow missing a member (DM context — guarded
 * elsewhere) or if the role shape is unrecognized.
 */
export function readMemberRoleIds(interaction: Interaction): readonly string[] {
  const member = interaction.member;
  if (typeof member !== 'object' || member === null) return [];
  const roles = (member as { roles?: unknown }).roles;
  if (Array.isArray(roles)) return roles.map(String);
  if (typeof roles === 'object' && roles !== null && 'cache' in roles) {
    const cache = (roles as { cache: { keys: () => IterableIterator<string> } }).cache;
    return [...cache.keys()];
  }
  return [];
}

/**
 * Pull the member's resolved permission bits as a bigint. Used by delete
 * which gates on ManageGuild. Returns 0n if the bitfield is missing —
 * fail-closed semantics for permission checks.
 */
export function readMemberPermissionsBits(interaction: Interaction): bigint {
  const perms = interaction.memberPermissions;
  if (perms === null) return 0n;
  return perms.bitfield;
}

/**
 * Send an ephemeral error reply for an AppError. Maps user-facing classes
 * (Permission/Conflict/NotFound) directly to their .message; everything
 * else falls back to i18n.common.errors.generic so internal-error
 * messages never leak to users. Honors `replied`/`deferred` state so it
 * can be called from any phase of an interaction.
 */
export async function replyAppError(interaction: ButtonInteraction, error: Error): Promise<void> {
  const message =
    error instanceof PermissionError ||
    error instanceof ConflictError ||
    error instanceof NotFoundError
      ? error.message
      : i18n.common.errors.generic;
  if (interaction.deferred || interaction.replied) {
    await interaction.followUp({ content: message, flags: MessageFlags.Ephemeral });
  } else {
    await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
  }
}
