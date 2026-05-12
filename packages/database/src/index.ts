// Public surface of @hearth/database. Single source of truth — nothing
// downstream imports from `drizzle-orm/*` directly. Schema, client,
// model row types, and SQL operators all flow through this barrel.

export { dbDrizzle, type DbDrizzle, type DbDrizzleTx } from './client.drizzle.js';
export * as schema from './schema/index.js';
export {
  type GuildConfig,
  type Panel,
  type PanelTicketType,
  RolePickerAction,
  type RolePickerEvent,
  type RolePickerOption,
  type RolePickerPanel,
  ReactionRolesAction,
  type ReactionRolesEvent,
  type ReactionRolesOption,
  type ReactionRolesPanel,
  type Ticket,
  type TicketEvent,
  type TicketEventMetadata,
  TicketStatus,
  type VerificationEvent,
  VerificationOutcome,
  type VerificationOption,
  type VerificationPanel,
} from './types.js';
export { TicketStatusValues } from './schema/_enums.js';
export {
  and,
  asc,
  count,
  countDistinct,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  ne,
  or,
  sql,
} from 'drizzle-orm';
export {
  getConstraintName,
  isForeignKeyViolation,
  isLockNotAvailable,
  isUniqueViolation,
} from './errors.js';
