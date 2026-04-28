import { TicketStatus } from '@discord-bot/database';
import { GuildConfigService } from '@discord-bot/tickets-core';
import {
  type AddTicketTypeInput,
  PanelService,
  type UpsertPanelInput,
} from '@discord-bot/tickets-core';
import { TicketService } from '@discord-bot/tickets-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FakeDiscordGateway } from '../../../../packages/tickets-core/tests/helpers/fakeGateway.js';
import { branding } from '../../src/config/branding.js';
import { type IntegrationDb, startIntegrationDb } from '../helpers/testDb.js';

const SHOULD_RUN = process.env['RUN_INTEGRATION'] === '1';

const baseUpsert: UpsertPanelInput = {
  guildId: 'g-int',
  channelId: 'c-int-support',
  embedTitle: 'Support',
  embedDescription: 'Click below.',
};

const baseTypeInput = (panelId: string): AddTicketTypeInput => ({
  panelId,
  name: 'support',
  label: 'Open ticket',
  emoji: '📨',
  activeCategoryId: 'cat-int-active',
  supportRoleIds: ['r-int-staff'],
  pingRoleIds: [],
  perUserLimit: 1,
});

const openInput = (panelId: string, typeId: string, openerId = 'u-int-1') => ({
  guildId: 'g-int',
  openerId,
  openerUsername: 'IntUser',
  panelId,
  typeId,
});

describe.runIf(SHOULD_RUN)('integration: ticket lifecycle (real Postgres)', () => {
  let env: IntegrationDb;
  let gateway: FakeDiscordGateway;
  let guildConfig: GuildConfigService;
  let panel: PanelService;
  let ticket: TicketService;
  let panelId: string;
  let typeId: string;

  beforeAll(async () => {
    env = await startIntegrationDb();
    gateway = new FakeDiscordGateway();
    guildConfig = new GuildConfigService(env.db);
    panel = new PanelService(env.db, gateway, branding);
    ticket = new TicketService(env.db, gateway, branding, guildConfig, panel);

    const upserted = await panel.upsertPanel(baseUpsert);
    if (!upserted.ok) throw upserted.error;
    panelId = upserted.value.panel.id;
    const typeAdded = await panel.addTicketType(baseTypeInput(panelId));
    if (!typeAdded.ok) throw typeAdded.error;
    typeId = typeAdded.value.id;

    await guildConfig.setArchiveCategory('g-int', '900000000000000000');
    await guildConfig.setLogChannel('g-int', '910000000000000000');
    gateway.reset();
  });

  afterAll(async () => {
    await env.close();
  });

  it('lifecycle: open → claim → close → reopen records every event in order', async () => {
    const opened = await ticket.openTicket(openInput(panelId, typeId, 'u-int-A'));
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    const claimed = await ticket.claimTicket({
      ticketId: opened.value.id,
      actorId: 'u-int-staff',
      actorRoleIds: ['r-int-staff'],
    });
    expect(claimed.ok).toBe(true);

    const closed = await ticket.closeTicket({
      ticketId: opened.value.id,
      actorId: 'u-int-A',
      actorRoleIds: [],
    });
    expect(closed.ok).toBe(true);

    const reopened = await ticket.reopenTicket({
      ticketId: opened.value.id,
      actorId: 'u-int-staff',
      actorRoleIds: ['r-int-staff'],
    });
    expect(reopened.ok).toBe(true);
    if (reopened.ok) expect(reopened.value.status).toBe(TicketStatus.claimed);

    const events = await env.db.ticketEvent.findMany({
      where: { ticketId: opened.value.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(events.map((e) => e.type)).toEqual(['opened', 'claimed', 'closed', 'reopened']);
  });

  it('lifecycle: open → close → delete cascades events but writes the deleted snapshot first', async () => {
    const opened = await ticket.openTicket(openInput(panelId, typeId, 'u-int-B'));
    if (!opened.ok) throw opened.error;

    await ticket.closeTicket({
      ticketId: opened.value.id,
      actorId: 'u-int-B',
      actorRoleIds: [],
    });

    gateway.reset();
    const result = await ticket.deleteTicket({
      ticketId: opened.value.id,
      actorId: 'u-int-admin',
      actorPermissionsBits: 1n << 5n, // PermissionFlagsBits.ManageGuild
    });
    expect(result.ok).toBe(true);

    const ticketGone = await env.db.ticket.findUnique({ where: { id: opened.value.id } });
    expect(ticketGone).toBeNull();
    const events = await env.db.ticketEvent.findMany({ where: { ticketId: opened.value.id } });
    expect(events).toHaveLength(0); // cascade

    expect(gateway.callsOf('postModlogSummary')).toHaveLength(1);
    expect(gateway.callsOf('deleteChannel')).toHaveLength(1);
  });

  it('partial-unique race: two concurrent opens for same (user, type) → exactly one succeeds', async () => {
    // Use a fresh opener so this test is independent of others above.
    const a = ticket.openTicket(openInput(panelId, typeId, 'u-int-RACE'));
    const b = ticket.openTicket(openInput(panelId, typeId, 'u-int-RACE'));
    const [resA, resB] = await Promise.all([a, b]);

    const okCount = [resA, resB].filter((r) => r.ok).length;
    const errCount = [resA, resB].filter((r) => !r.ok).length;
    expect(okCount).toBe(1);
    expect(errCount).toBe(1);

    const rows = await env.db.ticket.findMany({
      where: {
        guildId: 'g-int',
        openerId: 'u-int-RACE',
        status: { in: [TicketStatus.open, TicketStatus.claimed] },
      },
    });
    expect(rows).toHaveLength(1);
  });

  it('NotFoundError when panelId does not exist; no rows written', async () => {
    const before = await env.db.ticket.count();
    const result = await ticket.openTicket({
      guildId: 'g-int',
      openerId: 'u-int-NOPE',
      openerUsername: 'nope',
      panelId: 'does-not-exist',
      typeId: 'whatever',
    });
    expect(result.ok).toBe(false);
    const after = await env.db.ticket.count();
    expect(after).toBe(before);
  });
});
