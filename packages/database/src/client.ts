import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from './generated/client/client.js';

// Prisma 7 requires an explicit driver adapter. The DATABASE_URL is read
// from the host process — apps/bot validates and injects it via zod env
// before this module is evaluated.
const globalForPrisma = globalThis as unknown as { __discordBotDb: PrismaClient | undefined };

function createClient(): PrismaClient {
  const url = process.env['DATABASE_URL'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL must be set before instantiating the Prisma client');
  }
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: url }),
    log: process.env['NODE_ENV'] === 'development' ? ['query', 'warn', 'error'] : ['warn', 'error'],
  });
}

export const db: PrismaClient = globalForPrisma.__discordBotDb ?? createClient();

if (process.env['NODE_ENV'] !== 'production') {
  globalForPrisma.__discordBotDb = db;
}

export type DbClient = typeof db;
