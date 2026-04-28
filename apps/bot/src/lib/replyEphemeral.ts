import { ConflictError, NotFoundError, PermissionError, ValidationError } from '@hearth/shared';
import type { Interaction } from 'discord.js';
import { MessageFlags } from 'discord.js';

import { i18n } from '../i18n/index.js';

// Shared helpers used by the three interaction-error listeners. Splitting
// each listener into its own file (per Sapphire's one-piece-per-file rule)
// would otherwise trigger drift between three near-identical helpers.

export interface ReplyLogger {
  readonly error: (msg: string, err: unknown) => void;
}

/**
 * Reply to an interaction with an ephemeral message, honoring whether
 * it was already deferred or replied. Swallows reply failures
 * (interaction expired, missing permissions) silently — there is
 * nothing useful to log.
 */
export async function sendEphemeral(interaction: Interaction, message: string): Promise<void> {
  if (!('isRepliable' in interaction) || !interaction.isRepliable()) return;
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content: message, flags: MessageFlags.Ephemeral });
    } else {
      await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
    }
  } catch {
    // intentional: reply itself failed, do not spam logs.
  }
}

/**
 * Map an unknown thrown error to an ephemeral reply. AppError subclasses
 * that mark themselves user-facing pass their `message` straight through;
 * everything else is logged and replaced with the generic copy so internal
 * failure shapes never leak to users.
 */
export async function replyError(
  error: unknown,
  interaction: Interaction,
  logger: ReplyLogger,
): Promise<void> {
  const userFacing =
    error instanceof PermissionError ||
    error instanceof ConflictError ||
    error instanceof NotFoundError ||
    error instanceof ValidationError;
  const message = userFacing ? (error as Error).message : i18n.common.errors.generic;
  if (!userFacing) {
    logger.error('Unhandled interaction error', error);
  }
  await sendEphemeral(interaction, message);
}
