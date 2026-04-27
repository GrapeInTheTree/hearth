// Public surface of @discord-bot/database. Everything downstream uses this
// barrel — no other module imports from `@prisma/client` or the generated
// folder directly. That keeps the Prisma generator output contained: if we
// ever swap engines or move the generated path, only this file changes.

export { db, type DbClient } from './client.js';
export {
  Prisma,
  PrismaClient,
  type GuildConfig,
  type Panel,
  type PanelTicketType,
  type Ticket,
  type TicketEvent,
} from './generated/client/client.js';
export { TicketStatus } from './generated/client/enums.js';
