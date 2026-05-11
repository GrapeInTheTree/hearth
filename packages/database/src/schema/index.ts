// Drizzle schema barrel. The Drizzle client takes this whole namespace
// (`drizzle(pool, { schema })`) so the relational query API can resolve
// `db.query.ticket.findFirst({ with: { events: true } })` etc. Anything
// downstream — services, test helpers, dashboard RSC — imports the
// namespace (`import { schema } from '@hearth/database'`) and uses
// `schema.ticket` etc. as table references in queries.

export { ticketStatusEnum, TicketStatusValues, type TicketStatus } from './_enums.js';

export { guildConfig } from './guildConfig.js';
export { panel, panelRelations } from './panel.js';
export { panelTicketType, panelTicketTypeRelations } from './panelTicketType.js';
export { ticket, ticketRelations } from './ticket.js';
export { ticketEvent, ticketEventRelations } from './ticketEvent.js';
export { verificationPanel, verificationPanelRelations } from './verificationPanel.js';
export { verificationOption, verificationOptionRelations } from './verificationOption.js';
export { verificationEvent, verificationEventRelations } from './verificationEvent.js';
export { selfRolesPanel, selfRolesPanelRelations } from './selfRolesPanel.js';
export { selfRolesOption, selfRolesOptionRelations } from './selfRolesOption.js';
export { selfRolesEvent, selfRolesEventRelations } from './selfRolesEvent.js';
