import { dbDrizzle, type DbDrizzle } from '@hearth/database';
import { ReactionRolesService } from '@hearth/reaction-roles-core';
import { RolePickerService } from '@hearth/role-picker-core';
import {
  GuildConfigService,
  PanelService,
  TicketService,
  type DiscordGateway,
} from '@hearth/tickets-core';
import { VerificationService } from '@hearth/verification-core';
import { XWatcherService, type PollLogger } from '@hearth/x-watcher-core';
import { container } from '@sapphire/framework';

import { branding, type Branding } from './config/branding.js';
import { env, type Env } from './config/env.js';
import { XWatcherPoller } from './jobs/xWatcherPoller.js';
import { createXFeedSource } from './services/xFeedSourceFactory.js';

export interface Services {
  readonly guildConfig: GuildConfigService;
  readonly panel: PanelService;
  readonly ticket: TicketService;
  readonly verification: VerificationService;
  readonly reactionRoles: ReactionRolesService;
  readonly rolePicker: RolePickerService;
  readonly xWatcher: XWatcherService;
}

// Adapt Sapphire's container logger to the structured PollLogger the
// x-watcher poller expects. Reads container.logger lazily (at call time)
// so it's safe to build during attachServices, before the logger plugin
// has fully settled.
const pollLogger: PollLogger = {
  info: (msg, meta) => {
    if (meta) container.logger.info(msg, meta);
    else container.logger.info(msg);
  },
  warn: (msg, meta) => {
    if (meta) container.logger.warn(msg, meta);
    else container.logger.warn(msg);
  },
  error: (msg, meta) => {
    if (meta) container.logger.error(msg, meta);
    else container.logger.error(msg);
  },
};

declare module '@sapphire/pieces' {
  interface Container {
    env: Env;
    branding: Branding;
    db: DbDrizzle;
    /**
     * The DiscordGateway is wired in apps/bot/src/index.ts after the
     * SapphireClient is constructed (it needs the live Client). Until then
     * accessing this property is undefined behaviour.
     */
    gateway: DiscordGateway;
    services: Services;
    /**
     * The X-watcher poller. Wired in attachServices; started from the
     * ready listener (needs the live gateway) and stopped on shutdown.
     */
    xWatcherPoller: XWatcherPoller;
  }
}

container.env = env;
container.branding = branding;
container.db = dbDrizzle;

/**
 * Wire DiscordGateway-dependent services. Called from index.ts after the
 * SapphireClient is created. We construct the gateway with the client
 * reference, then build services that depend on it. Services themselves
 * never reach into Sapphire's container — they receive their dependencies
 * via constructor, so they remain trivially mockable in unit tests.
 */
export function attachServices(gateway: DiscordGateway): void {
  container.gateway = gateway;
  const guildConfig = new GuildConfigService(dbDrizzle);
  const panel = new PanelService(dbDrizzle, gateway, branding);
  const ticket = new TicketService(dbDrizzle, gateway, branding, guildConfig, panel);
  const verification = new VerificationService(dbDrizzle, gateway, branding);
  const reactionRoles = new ReactionRolesService(dbDrizzle, gateway, branding);
  const rolePicker = new RolePickerService(dbDrizzle, gateway, branding);
  const xWatcher = new XWatcherService(dbDrizzle);
  container.services = {
    guildConfig,
    panel,
    ticket,
    verification,
    reactionRoles,
    rolePicker,
    xWatcher,
  };
  container.xWatcherPoller = new XWatcherPoller({
    service: xWatcher,
    source: createXFeedSource(env, pollLogger),
    gateway,
    logger: pollLogger,
    intervalMs: env.X_WATCHER_POLL_INTERVAL_SEC * 1000,
  });
}
