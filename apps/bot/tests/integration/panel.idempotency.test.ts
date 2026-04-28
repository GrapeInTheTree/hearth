import { PanelService, type UpsertPanelInput } from '@hearth/tickets-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FakeDiscordGateway } from '../../../../packages/tickets-core/tests/helpers/fakeGateway.js';
import { branding } from '../../src/config/branding.js';
import { type IntegrationDb, startIntegrationDb } from '../helpers/testDb.js';

const SHOULD_RUN = process.env['RUN_INTEGRATION'] === '1';

const upsertInput: UpsertPanelInput = {
  guildId: 'g-idem',
  channelId: 'c-idem-support',
  embedTitle: 'Support',
  embedDescription: 'Click below.',
};

describe.runIf(SHOULD_RUN)('integration: panel idempotency (real Postgres)', () => {
  let env: IntegrationDb;
  let gateway: FakeDiscordGateway;
  let service: PanelService;

  beforeAll(async () => {
    env = await startIntegrationDb();
    gateway = new FakeDiscordGateway();
    service = new PanelService(env.db, gateway, branding);
  });

  afterAll(async () => {
    await env.close();
  });

  it('two upserts for same (guildId, channelId) result in 1 row + send-then-edit gateway sequence', async () => {
    const first = await service.upsertPanel(upsertInput);
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.value.created).toBe(true);

    const second = await service.upsertPanel(upsertInput);
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.value.created).toBe(false);

    const rows = await env.db.panel.findMany({
      where: { guildId: 'g-idem', channelId: 'c-idem-support' },
    });
    expect(rows).toHaveLength(1);

    // First call sends a fresh message; second edits the live one.
    expect(gateway.callsOf('sendPanelMessage')).toHaveLength(1);
    expect(gateway.callsOf('editPanelMessage')).toHaveLength(1);

    // Panel created with zero types — operator must add via /panel ticket-type add.
    const types = await env.db.panelTicketType.findMany({ where: { panelId: rows[0]?.id } });
    expect(types).toHaveLength(0);
  });
});
