// Verification domain logic — services, builder, schemas, i18n.
// Imported by both apps/bot (slash + interaction handler) and apps/dashboard
// (Server Actions). Reuses the DiscordGateway port from @hearth/tickets-core
// (single seam for the bot's Discord integration). Never imports the
// discord.js runtime; uses discord-api-types only for JSON shapes.

export {
  VerificationService,
  type VerificationCreateResult,
  type VerificationOptionEditInput,
  type VerificationOptionInput,
  type VerificationPanelEditInput,
  type VerificationPanelInput,
  type VerificationPanelWithOptions,
  type VerificationSubmissionResult,
} from './verificationService.js';

export {
  buildVerificationPayload,
  type VerificationComponentRow,
} from './lib/verificationBuilder.js';

export {
  VerificationOptionEditSchema,
  VerificationOptionInputSchema,
  VerificationPanelEditSchema,
  VerificationPanelInputSchema,
  type VerificationOptionEdit,
  type VerificationOptionInput as VerificationOptionInputType,
  type VerificationPanelEdit,
  type VerificationPanelInput as VerificationPanelInputType,
} from './schemas.js';

export { verification, type VerificationBundle } from './i18n/index.js';
