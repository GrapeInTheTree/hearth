// Self-roles domain logic — services, builder, schemas, i18n.
// Imported by both apps/bot (reaction listeners + slash) and
// apps/dashboard (Server Actions). Reuses the DiscordGateway port from
// @hearth/tickets-core (single seam for the bot's Discord integration).
// Never imports the discord.js runtime; uses discord-api-types only for
// JSON shapes.

export {
  ReactionRolesService,
  type ReactionRolesCreateResult,
  type ReactionRolesOptionEditInput,
  type ReactionRolesOptionInput,
  type ReactionRolesPanelEditInput,
  type ReactionRolesPanelInput,
  type ReactionRolesPanelWithOptions,
  type ReactionRolesReactionResult,
} from './reactionRolesService.js';

export {
  buildReactionRolesPayload,
  type ReactionRolesPayload,
} from './lib/reactionRolesBuilder.js';

export {
  MAX_OPTIONS_PER_PANEL,
  ReactionRolesOptionEditSchema,
  ReactionRolesOptionInputSchema,
  ReactionRolesPanelEditSchema,
  ReactionRolesPanelInputSchema,
  type ReactionRolesOptionEdit,
  type ReactionRolesOptionInput as ReactionRolesOptionInputType,
  type ReactionRolesPanelEdit,
  type ReactionRolesPanelInput as ReactionRolesPanelInputType,
} from './schemas.js';

export { reactionRoles, type ReactionRolesBundle } from './i18n/index.js';
