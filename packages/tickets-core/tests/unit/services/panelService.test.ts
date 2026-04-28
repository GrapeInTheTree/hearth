import type { TicketStatus } from '@hearth/database';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  type AddTicketTypeInput,
  PanelService,
  type UpsertPanelInput,
} from '../../../src/panelService.js';
import { createFakeDb, type FakeDb } from '../../helpers/fakeDb.js';
import { FakeDiscordGateway } from '../../helpers/fakeGateway.js';
import { branding } from '../../helpers/testBranding.js';

type TicketRowStatus = TicketStatus;

const baseUpsert: UpsertPanelInput = {
  guildId: 'g1',
  channelId: 'c-support',
  embedTitle: 'Contact Team',
  embedDescription: 'Click a button below.',
};

function typeInput(
  panelId: string,
  name: string,
  overrides: Partial<AddTicketTypeInput> = {},
): AddTicketTypeInput {
  return {
    panelId,
    name,
    label: `Open ${name}`,
    emoji: '📨',
    activeCategoryId: 'cat-active',
    supportRoleIds: ['r-staff'],
    pingRoleIds: [],
    perUserLimit: 1,
    ...overrides,
  };
}

describe('PanelService.upsertPanel', () => {
  let db: FakeDb;
  let gateway: FakeDiscordGateway;
  let service: PanelService;

  beforeEach(() => {
    db = createFakeDb();
    gateway = new FakeDiscordGateway();
    service = new PanelService(db, gateway, branding);
  });

  it('inserts a new panel with no ticket types and sends panel message', async () => {
    const result = await service.upsertPanel(baseUpsert);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.created).toBe(true);
    expect(db.tables.panel).toHaveLength(1);
    expect(db.tables.panelTicketType).toHaveLength(0);
    expect(gateway.callsOf('sendPanelMessage')).toHaveLength(1);
    expect(gateway.callsOf('editPanelMessage')).toHaveLength(0);
  });

  it('falls back to i18n defaults when title/description omitted', async () => {
    const result = await service.upsertPanel({ guildId: 'g1', channelId: 'c1' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.panel.embedTitle.length).toBeGreaterThan(0);
    expect(result.value.panel.embedDescription.length).toBeGreaterThan(0);
  });

  it('re-running edits the live message in place', async () => {
    await service.upsertPanel(baseUpsert);
    const second = await service.upsertPanel({ ...baseUpsert, embedTitle: 'New Title' });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.created).toBe(false);
    expect(db.tables.panel).toHaveLength(1);
    expect(db.tables.panel[0]?.embedTitle).toBe('New Title');
    expect(gateway.callsOf('sendPanelMessage')).toHaveLength(1);
    expect(gateway.callsOf('editPanelMessage')).toHaveLength(1);
  });
});

describe('PanelService.addTicketType', () => {
  let db: FakeDb;
  let gateway: FakeDiscordGateway;
  let service: PanelService;
  let panelId: string;

  beforeEach(async () => {
    db = createFakeDb();
    gateway = new FakeDiscordGateway();
    service = new PanelService(db, gateway, branding);
    const upserted = await service.upsertPanel(baseUpsert);
    if (!upserted.ok) throw new Error('seed failed');
    panelId = upserted.value.panel.id;
    gateway.reset();
  });

  it('inserts a new type and re-renders the panel', async () => {
    const result = await service.addTicketType(typeInput(panelId, 'question'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.name).toBe('question');
    expect(db.tables.panelTicketType).toHaveLength(1);
    expect(gateway.callsOf('editPanelMessage')).toHaveLength(1);
  });

  it('rejects duplicate name on the same panel', async () => {
    await service.addTicketType(typeInput(panelId, 'question'));
    const dup = await service.addTicketType(typeInput(panelId, 'question'));
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error.code).toBe('CONFLICT');
    expect(db.tables.panelTicketType).toHaveLength(1);
  });

  it('rejects unknown panelId', async () => {
    const result = await service.addTicketType(typeInput('does-not-exist', 'q'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_FOUND');
  });

  it('two distinct types coexist on one panel', async () => {
    const a = await service.addTicketType(typeInput(panelId, 'question'));
    const b = await service.addTicketType(typeInput(panelId, 'business-offer'));
    expect(a.ok && b.ok).toBe(true);
    expect(db.tables.panelTicketType).toHaveLength(2);
    // Two re-renders, one per addition.
    expect(gateway.callsOf('editPanelMessage')).toHaveLength(2);
  });
});

describe('PanelService.editTicketType', () => {
  let db: FakeDb;
  let gateway: FakeDiscordGateway;
  let service: PanelService;
  let panelId: string;

  beforeEach(async () => {
    db = createFakeDb();
    gateway = new FakeDiscordGateway();
    service = new PanelService(db, gateway, branding);
    const upserted = await service.upsertPanel(baseUpsert);
    if (!upserted.ok) throw new Error('seed failed');
    panelId = upserted.value.panel.id;
    await service.addTicketType(typeInput(panelId, 'question'));
    gateway.reset();
  });

  it('updates label without touching other fields', async () => {
    const result = await service.editTicketType({
      panelId,
      name: 'question',
      label: 'Question (1:1)',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.buttonLabel).toBe('Question (1:1)');
    expect(result.value.activeCategoryId).toBe('cat-active');
    expect(gateway.callsOf('editPanelMessage')).toHaveLength(1);
  });

  it('returns NotFoundError when name is missing', async () => {
    const result = await service.editTicketType({
      panelId,
      name: 'nope',
      label: 'whatever',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_FOUND');
  });

  it('clears welcomeMessage when explicitly set to null', async () => {
    await service.editTicketType({
      panelId,
      name: 'question',
      welcomeMessage: 'Custom copy',
    });
    expect(db.tables.panelTicketType[0]?.welcomeMessage).toBe('Custom copy');
    await service.editTicketType({
      panelId,
      name: 'question',
      welcomeMessage: null,
    });
    expect(db.tables.panelTicketType[0]?.welcomeMessage).toBeNull();
  });
});

describe('PanelService.removeTicketType', () => {
  let db: FakeDb;
  let gateway: FakeDiscordGateway;
  let service: PanelService;
  let panelId: string;
  let typeId: string;

  beforeEach(async () => {
    db = createFakeDb();
    gateway = new FakeDiscordGateway();
    service = new PanelService(db, gateway, branding);
    const upserted = await service.upsertPanel(baseUpsert);
    if (!upserted.ok) throw new Error('seed failed');
    panelId = upserted.value.panel.id;
    const added = await service.addTicketType(typeInput(panelId, 'question'));
    if (!added.ok) throw new Error('seed failed');
    typeId = added.value.id;
    gateway.reset();
  });

  it('removes a type with no tickets', async () => {
    const result = await service.removeTicketType(panelId, 'question');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.removedId).toBe(typeId);
    expect(db.tables.panelTicketType).toHaveLength(0);
    expect(gateway.callsOf('editPanelMessage')).toHaveLength(1);
  });

  it('refuses to remove a type with referencing tickets', async () => {
    db.tables.ticket.push({
      id: 't1',
      guildId: 'g1',
      panelId,
      panelTypeId: typeId,
      channelId: 'chan-1',
      welcomeMessageId: null,
      number: 1,
      openerId: 'u1',
      claimedById: null,
      status: 'open' as unknown as TicketRowStatus,
      openedAt: new Date(),
      claimedAt: null,
      closedAt: null,
      closedById: null,
      closeReason: null,
    });

    const result = await service.removeTicketType(panelId, 'question');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('CONFLICT');
    expect(db.tables.panelTicketType).toHaveLength(1);
  });

  it('returns NotFoundError on unknown name', async () => {
    const result = await service.removeTicketType(panelId, 'nope');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_FOUND');
  });
});

describe('PanelService.getPanelTypeForOpen', () => {
  let db: FakeDb;
  let gateway: FakeDiscordGateway;
  let service: PanelService;
  let panelId: string;
  let typeId: string;

  beforeEach(async () => {
    db = createFakeDb();
    gateway = new FakeDiscordGateway();
    service = new PanelService(db, gateway, branding);
    const upserted = await service.upsertPanel(baseUpsert);
    if (!upserted.ok) throw new Error('seed failed');
    panelId = upserted.value.panel.id;
    const added = await service.addTicketType(typeInput(panelId, 'question'));
    if (!added.ok) throw new Error('seed failed');
    typeId = added.value.id;
  });

  it('returns panel + type when both exist', async () => {
    const got = await service.getPanelTypeForOpen(panelId, typeId);
    expect(got.ok).toBe(true);
    if (got.ok) expect(got.value.type.name).toBe('question');
  });

  it('returns NotFoundError for missing panel', async () => {
    const got = await service.getPanelTypeForOpen('does-not-exist', typeId);
    expect(got.ok).toBe(false);
  });

  it('returns NotFoundError for missing type', async () => {
    const got = await service.getPanelTypeForOpen(panelId, 'wrong-type');
    expect(got.ok).toBe(false);
  });
});
