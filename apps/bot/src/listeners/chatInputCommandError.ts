import { Events, Listener } from '@sapphire/framework';
import type { ChatInputCommandErrorPayload } from '@sapphire/framework';

import { replyError } from '../lib/replyEphemeral.js';

// Sapphire emits ChatInputCommandError when a slash command's chatInputRun()
// throws. Pairs with InteractionHandlerError; both delegate to the same
// AppError-aware reply helper.
export class ChatInputCommandErrorListener extends Listener<typeof Events.ChatInputCommandError> {
  public constructor(context: Listener.LoaderContext, options: Listener.Options) {
    super(context, { ...options, event: Events.ChatInputCommandError });
  }

  public override async run(error: unknown, payload: ChatInputCommandErrorPayload): Promise<void> {
    await replyError(error, payload.interaction, this.container.logger);
  }
}
