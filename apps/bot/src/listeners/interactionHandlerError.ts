import { Events, Listener } from '@sapphire/framework';
import type { InteractionHandlerError } from '@sapphire/framework';

import { replyError } from '../lib/replyEphemeral.js';

// Sapphire emits InteractionHandlerError when a button / select-menu / modal
// handler's run() throws. This is the safety net for unexpected throws —
// service-layer Result.err returns are already mapped at the handler.
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
