// Role-picker domain logic — services, builder, schemas, i18n.
// StringSelectMenu-based role picker (single or multi-select dropdown).
// Imported by both apps/bot (interaction handler + slash) and
// apps/dashboard (Server Actions). Reuses the DiscordGateway port from
// @hearth/tickets-core (single seam for the bot's Discord integration).
// Never imports the discord.js runtime; uses discord-api-types only for
// JSON shapes.

export {
  RolePickerService,
  type RolePickerCreateResult,
  type RolePickerOptionEditInput,
  type RolePickerOptionInput,
  type RolePickerPanelEditInput,
  type RolePickerPanelInput,
  type RolePickerPanelWithOptions,
  type RolePickerSelectionResult,
} from './rolePickerService.js';

export { buildRolePickerPayload, type RolePickerPayload } from './lib/rolePickerBuilder.js';
export { buildRolePickerCustomId } from './lib/customIdHelpers.js';

export {
  MAX_OPTIONS_PER_PANEL,
  RolePickerOptionEditSchema,
  RolePickerOptionInputSchema,
  RolePickerPanelEditSchema,
  RolePickerPanelInputSchema,
  type RolePickerOptionEdit,
  type RolePickerOptionInput as RolePickerOptionInputType,
  type RolePickerPanelEdit,
  type RolePickerPanelInput as RolePickerPanelInputType,
} from './schemas.js';

export { rolePicker, type RolePickerBundle } from './i18n/index.js';
