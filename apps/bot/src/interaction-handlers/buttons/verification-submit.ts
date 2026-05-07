import { VerificationOutcome } from '@hearth/database';
import { decode, matchesAction } from '@hearth/tickets-core';
import { InteractionHandler, InteractionHandlerTypes } from '@sapphire/framework';
import { type ButtonInteraction, MessageFlags } from 'discord.js';

import { i18n } from '../../i18n/index.js';

interface VerificationSubmitPayload {
  readonly panelId: string;
  readonly optionId: string;
}

/**
 * Routes the click on a verification panel button. The reply has to be
 * ephemeral-deferred immediately because Discord's 3-second window is
 * shorter than a guild member fetch + role assign under load.
 *
 * Outcome → ephemeral message map (i18n bundle):
 *   success            → ✅ Verified! …
 *   wrong_answer       → ❌ That's not right …
 *   already_verified   → You already have the verification role.
 *   role_assign_failed → Could not assign your role …
 *
 * Service errors fall through to the generic message — the verification
 * service maps known cases to outcomes; anything else is unexpected.
 */
export class VerificationSubmitHandler extends InteractionHandler {
  public constructor(
    context: InteractionHandler.LoaderContext,
    options: InteractionHandler.Options,
  ) {
    super(context, { ...options, interactionHandlerType: InteractionHandlerTypes.Button });
  }

  public override parse(interaction: ButtonInteraction) {
    if (!matchesAction(interaction.customId, 'verification:submit')) return this.none();
    try {
      const payload: VerificationSubmitPayload = decode(
        interaction.customId,
        'verification:submit',
      );
      return this.some(payload);
    } catch (err) {
      this.container.logger.warn('verification-submit: malformed customId', err);
      return this.none();
    }
  }

  public async run(
    interaction: ButtonInteraction,
    payload: VerificationSubmitPayload,
  ): Promise<void> {
    if (interaction.guildId === null) return;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const result = await this.container.services.verification.handleSubmission({
      panelId: payload.panelId,
      optionId: payload.optionId,
      userId: interaction.user.id,
    });

    if (!result.ok) {
      // NotFoundError / panel-config invariants → use the AppError message
      // directly so admins debugging a misconfigured panel see the real
      // reason. Generic fallback covers anything we forgot to map.
      const message =
        typeof result.error.message === 'string' && result.error.message.length > 0
          ? result.error.message
          : i18n.common.errors.generic;
      await interaction.editReply({ content: message });
      return;
    }

    const outcomes = i18n.verification.outcomes;
    const message =
      result.value.outcome === VerificationOutcome.success
        ? outcomes.success
        : result.value.outcome === VerificationOutcome.wrongAnswer
          ? outcomes.wrongAnswer
          : result.value.outcome === VerificationOutcome.alreadyVerified
            ? outcomes.alreadyVerified
            : outcomes.roleAssignFailed;
    await interaction.editReply({ content: message });
  }
}
