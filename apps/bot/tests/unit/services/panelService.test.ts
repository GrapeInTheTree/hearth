import { beforeEach, describe, expect, it } from 'vitest';

import { branding } from '../../../src/config/branding.js';
import { PanelService, type UpsertPanelInput } from '../../../src/services/panelService.js';
import { createFakeDb, type FakeDb } from '../../helpers/fakeDb.js';
import { FakeDiscordGateway } from '../../helpers/fakeGateway.js';

const baseInput: UpsertPanelInput = {
  guildId: 'g1',
  channelId: 'c-support',
  type: 'support',
  activeCategoryId: 'cat-active',
  supportRoleIds: ['r-staff'],
  pingRoleIds: ['r-mvp'],
  perUserLimit: 1,
};

describe('PanelService', () => {
  let db: FakeDb;
  let gateway: FakeDiscordGateway;
  let service: PanelService;

  beforeEach(() => {
    db = createFakeDb();
    gateway = new FakeDiscordGateway();
    service = new PanelService(db, gateway, branding);
  });

  it('upsertPanel inserts new panel + ticketType + sends panel message', async () => {
    const result = await service.upsertPanel(baseInput);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.created).toBe(true);
    expect(db.tables.panel).toHaveLength(1);
    expect(db.tables.panelTicketType).toHaveLength(1);
    expect(gateway.callsOf('sendPanelMessage')).toHaveLength(1);
    expect(gateway.callsOf('editPanelMessage')).toHaveLength(0);
  });

  it('upsertPanel re-run edits existing panel instead of inserting', async () => {
    await service.upsertPanel(baseInput);
    const second = await service.upsertPanel(baseInput);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.created).toBe(false);
    expect(db.tables.panel).toHaveLength(1);
    expect(db.tables.panelTicketType).toHaveLength(1);
    expect(gateway.callsOf('sendPanelMessage')).toHaveLength(1);
    expect(gateway.callsOf('editPanelMessage')).toHaveLength(1);
  });

  it('upsertPanel cross-ref substitutes {offerChannel} when otherPanelChannelId provided', async () => {
    const result = await service.upsertPanel({ ...baseInput, otherPanelChannelId: 'c-offer' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.panel.embedDescription).toContain('<#c-offer>');
  });

  it('getPanelTypeForOpen returns panel + type when both exist', async () => {
    const upserted = await service.upsertPanel(baseInput);
    if (!upserted.ok) throw new Error('seed failed');
    const got = await service.getPanelTypeForOpen(
      upserted.value.panel.id,
      upserted.value.ticketType.id,
    );
    expect(got.ok).toBe(true);
    if (got.ok) expect(got.value.type.name).toBe('support');
  });

  it('getPanelTypeForOpen returns NotFoundError on bad panelId', async () => {
    const got = await service.getPanelTypeForOpen('does-not-exist', 'whatever');
    expect(got.ok).toBe(false);
  });

  it('getPanelTypeForOpen returns NotFoundError on bad typeId', async () => {
    const upserted = await service.upsertPanel(baseInput);
    if (!upserted.ok) throw new Error('seed failed');
    const got = await service.getPanelTypeForOpen(upserted.value.panel.id, 'wrong-type');
    expect(got.ok).toBe(false);
  });
});
