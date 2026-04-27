import { Events, Listener } from '@sapphire/framework';
import type { ChatInputCommandDeniedPayload, UserError } from '@sapphire/framework';

import { i18n } from '../i18n/index.js';
import { sendEphemeral } from '../lib/replyEphemeral.js';

// Sapphire emits ChatInputCommandDenied when a precondition (e.g. AdminOnly)
// returns this.error(...). Crucially the framework does NOT auto-reply on
// denial — Discord then times out at 3s with "application did not respond".
// This listener relays the precondition's error message ephemerally so the
// user sees why their command was blocked.
export class ChatInputCommandDeniedListener extends Listener<typeof Events.ChatInputCommandDenied> {
  public constructor(context: Listener.LoaderContext, options: Listener.Options) {
    super(context, { ...options, event: Events.ChatInputCommandDenied });
  }

  public override async run(
    error: UserError,
    payload: ChatInputCommandDeniedPayload,
  ): Promise<void> {
    const message = error.message !== '' ? error.message : i18n.common.errors.generic;
    await sendEphemeral(payload.interaction, message);
  }
}
