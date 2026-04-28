// Ticket domain logic — services, ports, schemas, builders, i18n.
// Imported by both apps/bot (slash commands + interaction handlers) and
// apps/dashboard (Server Actions). Never imports the discord.js runtime;
// uses discord-api-types only for JSON shapes.

export type { Branding } from './branding.js';

export type {
  AddTicketTypeInput,
  EditTicketTypeInput,
  UpsertPanelInput,
  UpsertPanelResult,
} from './panelService.js';
export { PanelService } from './panelService.js';

export type { ActorInput, DeleteTicketInput, OpenTicketInput } from './ticketService.js';
export { TicketService } from './ticketService.js';

export { GuildConfigService } from './guildConfigService.js';

export type {
  CreateTicketChannelInput,
  DiscordGateway,
  ModlogEmbed,
  PanelMessagePayload,
  SendWelcomeMessageInput,
} from './ports/discordGateway.js';

export {
  GuildConfigInputSchema,
  PanelInputSchema,
  TicketTypeInputSchema,
  type GuildConfigInput,
  type PanelInput,
  type TicketTypeInput,
} from './schemas.js';

// i18n surface for both bot listeners (e.g., chatInputCommandDenied) and
// dashboard error mapping. tickets-core ships English only today; passing a
// different bundle in the future requires no API change.
export { format, tickets, type TicketsBundle } from './i18n/index.js';

// lib re-exports — kept narrow: only the utilities consumers actually need.
export {
  decode,
  encode,
  matchesAction,
  type CustomIdAction,
  type CustomIdPayloadFor,
} from './lib/customId.js';
export { withAdvisoryLock } from './lib/advisoryLock.js';
export { ticketOpenLockKey } from './lib/lockKeys.js';
export { formatChannelName, normalizeUsername } from './lib/format.js';
export { buildPanelComponents, type PanelComponentRow } from './lib/panelBuilder.js';
export {
  buildWelcomeMessage,
  type WelcomeBranding,
  type WelcomeButtonState,
  type WelcomeMessageInput,
  type WelcomeMessagePayload,
} from './lib/welcomeBuilder.js';
export {
  assertManageGuild,
  assertSupportStaff,
  hasManageGuild,
  isSupportStaff,
} from './lib/permissions.js';
export { parseSnowflake, parseSnowflakeList, SnowflakeSchema } from './lib/snowflake.js';
