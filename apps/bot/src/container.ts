import { db, type DbClient } from '@discord-bot/database';
import { container } from '@sapphire/framework';

import { branding, type Branding } from './config/branding.js';
import { env, type Env } from './config/env.js';

declare module '@sapphire/pieces' {
  interface Container {
    env: Env;
    branding: Branding;
    db: DbClient;
    // Phase 1 PR-2 adds: gateway, services
  }
}

container.env = env;
container.branding = branding;
container.db = db;
