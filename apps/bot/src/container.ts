import { db, type DbClient } from '@hearth/database';
import {
  GuildConfigService,
  PanelService,
  TicketService,
  type DiscordGateway,
} from '@hearth/tickets-core';
import { container } from '@sapphire/framework';

import { branding, type Branding } from './config/branding.js';
import { env, type Env } from './config/env.js';

export interface Services {
  readonly guildConfig: GuildConfigService;
  readonly panel: PanelService;
  readonly ticket: TicketService;
}

declare module '@sapphire/pieces' {
  interface Container {
    env: Env;
    branding: Branding;
    db: DbClient;
    /**
     * The DiscordGateway is wired in apps/bot/src/index.ts after the
     * SapphireClient is constructed (it needs the live Client). Until then
     * accessing this property is undefined behaviour.
     */
    gateway: DiscordGateway;
    services: Services;
  }
}

container.env = env;
container.branding = branding;
container.db = db;

/**
 * Wire DiscordGateway-dependent services. Called from index.ts after the
 * SapphireClient is created. We construct the gateway with the client
 * reference, then build services that depend on it. Services themselves
 * never reach into Sapphire's container — they receive their dependencies
 * via constructor, so they remain trivially mockable in unit tests.
 */
export function attachServices(gateway: DiscordGateway): void {
  container.gateway = gateway;
  const guildConfig = new GuildConfigService(db);
  const panel = new PanelService(db, gateway, branding);
  const ticket = new TicketService(db, gateway, branding, guildConfig, panel);
  container.services = { guildConfig, panel, ticket };
}
