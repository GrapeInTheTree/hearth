import {
  ConflictError,
  NotFoundError,
  PermissionError,
  ValidationError,
} from '@discord-bot/shared';
import { Events, Listener } from '@sapphire/framework';
import type {
  ChatInputCommandDeniedPayload,
  ChatInputCommandErrorPayload,
  InteractionHandlerError,
  UserError,
} from '@sapphire/framework';
import type { Interaction } from 'discord.js';
import { MessageFlags } from 'discord.js';

import { i18n } from '../i18n/index.js';

// Three Sapphire events worth handling for slash commands:
//
//   InteractionHandlerError — handler/component code threw
//   ChatInputCommandError    — slash command's run() threw
//   ChatInputCommandDenied   — a precondition (e.g. AdminOnly) returned err()
//
// The first two are unexpected; the third is the normal path for the user
// trying to use a gated command. Sapphire does NOT auto-reply on Denied —
// without this listener the interaction times out with "application did
// not respond" because the precondition's error message never reaches Discord.
//
// Strategy:
//   AppError.userFacing===true → ephemeral reply with error.message
//   Denied (UserError)         → ephemeral reply with userError.message
//   anything else              → log + Sentry + ephemeral generic copy

export class InteractionHandlerErrorListener extends Listener<
  typeof Events.InteractionHandlerError
> {
  public constructor(context: Listener.LoaderContext, options: Listener.Options) {
    super(context, { ...options, event: Events.InteractionHandlerError });
  }

  public override async run(error: unknown, payload: InteractionHandlerError): Promise<void> {
    await replyError(error, payload.interaction, this.container.logger);
  }
}

export class ChatInputCommandErrorListener extends Listener<typeof Events.ChatInputCommandError> {
  public constructor(context: Listener.LoaderContext, options: Listener.Options) {
    super(context, { ...options, event: Events.ChatInputCommandError });
  }

  public override async run(error: unknown, payload: ChatInputCommandErrorPayload): Promise<void> {
    await replyError(error, payload.interaction, this.container.logger);
  }
}

export class ChatInputCommandDeniedListener extends Listener<typeof Events.ChatInputCommandDenied> {
  public constructor(context: Listener.LoaderContext, options: Listener.Options) {
    super(context, { ...options, event: Events.ChatInputCommandDenied });
  }

  public override async run(
    error: UserError,
    payload: ChatInputCommandDeniedPayload,
  ): Promise<void> {
    await replyDenied(error, payload.interaction);
  }
}

async function replyError(
  error: unknown,
  interaction: Interaction,
  logger: { error: (msg: string, err: unknown) => void },
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

async function replyDenied(error: UserError, interaction: Interaction): Promise<void> {
  // Precondition messages are already i18n strings (see preconditions/*).
  // Fall back to the generic copy if a precondition forgot to set one.
  const message = error.message !== '' ? error.message : i18n.common.errors.generic;
  await sendEphemeral(interaction, message);
}

async function sendEphemeral(interaction: Interaction, message: string): Promise<void> {
  if (!('isRepliable' in interaction) || !interaction.isRepliable()) return;
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content: message, flags: MessageFlags.Ephemeral });
    } else {
      await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
    }
  } catch {
    // Reply itself failed (interaction expired, missing permissions). Stay
    // silent so we don't spam the logs.
  }
}
