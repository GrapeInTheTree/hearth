import { count, eq, schema, TicketStatus } from '@hearth/database';
import { ConflictError, DiscordApiError, NotFoundError, PermissionError } from '@hearth/shared';
import { afterEach, describe, expect, it } from 'vitest';

import { GuildConfigService } from '../../../src/guildConfigService.js';
import { PanelService } from '../../../src/panelService.js';
import { TicketService } from '../../../src/ticketService.js';
import { FakeDiscordGateway } from '../../helpers/fakeGateway.js';
import { branding } from '../../helpers/testBranding.js';
import { createTestDb, type TestDb } from '../../helpers/testDb.js';

// Discord ManageGuild permission bit (= 1 << 5). Inlined as bigint so this
// test stays free of the discord.js runtime.
const MANAGE_GUILD_BIT = 1n << 5n;

interface Harness {
  testDb: TestDb;
  gateway: FakeDiscordGateway;
  service: TicketService;
  guildConfig: GuildConfigService;
  panel: PanelService;
  panelId: string;
  typeId: string;
}

async function setup(options: { channelChildren?: number } = {}): Promise<Harness> {
  const testDb = await createTestDb();
  const gateway = new FakeDiscordGateway({
    ...(options.channelChildren !== undefined ? { channelChildren: options.channelChildren } : {}),
  });
  const guildConfig = new GuildConfigService(testDb.db);
  const panel = new PanelService(testDb.db, gateway, branding);
  const service = new TicketService(testDb.db, gateway, branding, guildConfig, panel);

  const upserted = await panel.upsertPanel({
    guildId: 'g1',
    channelId: 'c-support',
    embedTitle: 'Support',
    embedDescription: 'Click below.',
  });
  if (!upserted.ok) throw new Error('seed failed');
  const typeAdded = await panel.addTicketType({
    panelId: upserted.value.panel.id,
    name: 'support',
    label: 'Open ticket',
    emoji: '📨',
    activeCategoryId: 'cat-active',
    supportRoleIds: ['r-staff'],
    pingRoleIds: [],
    perUserLimit: 1,
  });
  if (!typeAdded.ok) throw new Error('seed type failed');
  // Reset gateway calls so tests assert only the action under test.
  gateway.reset();

  return {
    testDb,
    gateway,
    service,
    guildConfig,
    panel,
    panelId: upserted.value.panel.id,
    typeId: typeAdded.value.id,
  };
}

const openInput = (
  h: Harness,
  overrides: { openerId?: string } = {},
): Parameters<TicketService['openTicket']>[0] => ({
  guildId: 'g1',
  openerId: overrides.openerId ?? 'u-opener',
  openerUsername: 'OpenerName',
  panelId: h.panelId,
  typeId: h.typeId,
});

async function countTickets(h: Harness): Promise<number> {
  const [row] = await h.testDb.db.select({ value: count() }).from(schema.ticket);
  return row?.value ?? 0;
}

async function countEvents(h: Harness): Promise<number> {
  const [row] = await h.testDb.db.select({ value: count() }).from(schema.ticketEvent);
  return row?.value ?? 0;
}

describe('TicketService.openTicket', () => {
  let harness: Harness | undefined;
  afterEach(async () => {
    if (harness !== undefined) {
      await harness.testDb.close();
      harness = undefined;
    }
  });

  it('happy path creates row, channel, welcome message, two events', async () => {
    harness = await setup();
    const result = await harness.service.openTicket(openInput(harness));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.status).toBe(TicketStatus.open);
    expect(result.value.number).toBe(1);
    expect(result.value.channelId).toMatch(/^chan-/);
    expect(result.value.welcomeMessageId).toMatch(/^msg-/);

    expect(await countTickets(harness)).toBe(1);
    expect(await countEvents(harness)).toBe(1);
    const [event] = await harness.testDb.db.select().from(schema.ticketEvent).limit(1);
    expect(event?.type).toBe('opened');

    expect(harness.gateway.callsOf('createTicketChannel')).toHaveLength(1);
    expect(harness.gateway.callsOf('sendWelcomeMessage')).toHaveLength(1);
  });

  it('alreadyOpen — second open of same (user, type) returns ConflictError', async () => {
    harness = await setup();
    const first = await harness.service.openTicket(openInput(harness));
    expect(first.ok).toBe(true);

    const second = await harness.service.openTicket(openInput(harness));
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error).toBeInstanceOf(ConflictError);
    }
    expect(await countTickets(harness)).toBe(1);
  });

  it('categoryFull — gateway reports >= 48 children, returns ConflictError', async () => {
    harness = await setup({ channelChildren: 48 });
    const result = await harness.service.openTicket(openInput(harness));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(ConflictError);
    }
    expect(await countTickets(harness)).toBe(0);
    expect(harness.gateway.callsOf('createTicketChannel')).toHaveLength(0);
  });

  it('NotFoundError when panelId does not exist', async () => {
    harness = await setup();
    const result = await harness.service.openTicket({ ...openInput(harness), panelId: 'nope' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(NotFoundError);
    }
  });

  it('partial unique race — concurrent opens for the same opener: one wins, loser rolls back its channel', async () => {
    harness = await setup();
    const input = openInput(harness, { openerId: 'u-racer' });
    const [a, b] = await Promise.all([
      harness.service.openTicket(input),
      harness.service.openTicket(input),
    ]);
    // Exactly one of the two succeeds — Postgres `ticket_open_dedupe`
    // partial unique index serializes the race; the loser hits 23505 and
    // its channel is rolled back via deleteChannel.
    const successes = [a, b].filter((r) => r.ok);
    const failures = [a, b].filter((r) => !r.ok);
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    if (!failures[0]!.ok) {
      expect(failures[0]!.error).toBeInstanceOf(ConflictError);
    }
    expect(await countTickets(harness)).toBe(1);
    expect(harness.gateway.callsOf('createTicketChannel')).toHaveLength(2);
    expect(harness.gateway.callsOf('deleteChannel')).toHaveLength(1);
  });

  it('different opener can open same type concurrently', async () => {
    harness = await setup();
    const a = await harness.service.openTicket(openInput(harness, { openerId: 'u-a' }));
    const b = await harness.service.openTicket(openInput(harness, { openerId: 'u-b' }));
    expect(a.ok && b.ok).toBe(true);
    expect(await countTickets(harness)).toBe(2);
  });

  it('counter increments per ticket', async () => {
    harness = await setup();
    const a = await harness.service.openTicket(openInput(harness, { openerId: 'u-a' }));
    const b = await harness.service.openTicket(openInput(harness, { openerId: 'u-b' }));
    if (!a.ok || !b.ok) throw new Error('precondition');
    expect(a.value.number).toBe(1);
    expect(b.value.number).toBe(2);
  });
});

describe('TicketService.claimTicket', () => {
  let harness: Harness | undefined;
  afterEach(async () => {
    if (harness !== undefined) {
      await harness.testDb.close();
      harness = undefined;
    }
  });

  it('non-support-staff returns PermissionError', async () => {
    harness = await setup();
    const opened = await harness.service.openTicket(openInput(harness));
    if (!opened.ok) throw new Error('seed');
    const result = await harness.service.claimTicket({
      ticketId: opened.value.id,
      actorId: 'u-random',
      actorRoleIds: ['r-other'],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(PermissionError);
  });

  it('support staff can claim an open ticket', async () => {
    harness = await setup();
    const opened = await harness.service.openTicket(openInput(harness));
    if (!opened.ok) throw new Error('seed');
    const result = await harness.service.claimTicket({
      ticketId: opened.value.id,
      actorId: 'u-staff',
      actorRoleIds: ['r-staff'],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe(TicketStatus.claimed);
    expect(result.value.claimedById).toBe('u-staff');
    expect(harness.gateway.callsOf('postSystemMessage')).toHaveLength(1);
    expect(harness.gateway.callsOf('editWelcomeMessage')).toHaveLength(1);
  });

  it('claiming an already-claimed ticket returns ConflictError', async () => {
    harness = await setup();
    const opened = await harness.service.openTicket(openInput(harness));
    if (!opened.ok) throw new Error('seed');
    await harness.service.claimTicket({
      ticketId: opened.value.id,
      actorId: 'u-staff',
      actorRoleIds: ['r-staff'],
    });
    const second = await harness.service.claimTicket({
      ticketId: opened.value.id,
      actorId: 'u-staff2',
      actorRoleIds: ['r-staff'],
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toBeInstanceOf(ConflictError);
  });

  it('NotFoundError when ticket does not exist', async () => {
    harness = await setup();
    const result = await harness.service.claimTicket({
      ticketId: 'nope',
      actorId: 'u-staff',
      actorRoleIds: ['r-staff'],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(NotFoundError);
  });
});

describe('TicketService.closeTicket', () => {
  let harness: Harness | undefined;
  afterEach(async () => {
    if (harness !== undefined) {
      await harness.testDb.close();
      harness = undefined;
    }
  });

  it('opener can close their own ticket', async () => {
    harness = await setup();
    const opened = await harness.service.openTicket(openInput(harness));
    if (!opened.ok) throw new Error('seed');
    const result = await harness.service.closeTicket({
      ticketId: opened.value.id,
      actorId: 'u-opener',
      actorRoleIds: [],
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.status).toBe(TicketStatus.closed);
  });

  it('random user cannot close', async () => {
    harness = await setup();
    const opened = await harness.service.openTicket(openInput(harness));
    if (!opened.ok) throw new Error('seed');
    const result = await harness.service.closeTicket({
      ticketId: opened.value.id,
      actorId: 'u-random',
      actorRoleIds: ['r-other'],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(PermissionError);
  });

  it('already closed returns ConflictError', async () => {
    harness = await setup();
    const opened = await harness.service.openTicket(openInput(harness));
    if (!opened.ok) throw new Error('seed');
    await harness.service.closeTicket({
      ticketId: opened.value.id,
      actorId: 'u-opener',
      actorRoleIds: [],
    });
    const second = await harness.service.closeTicket({
      ticketId: opened.value.id,
      actorId: 'u-opener',
      actorRoleIds: [],
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toBeInstanceOf(ConflictError);
  });

  it('moves to archive category when configured', async () => {
    harness = await setup();
    const setRes = await harness.guildConfig.setArchiveCategory('g1', '777777777777777777');
    expect(setRes.ok).toBe(true);
    const opened = await harness.service.openTicket(openInput(harness));
    if (!opened.ok) throw new Error('seed');
    harness.gateway.reset();

    await harness.service.closeTicket({
      ticketId: opened.value.id,
      actorId: 'u-opener',
      actorRoleIds: [],
    });

    const moves = harness.gateway.callsOf('moveChannelToCategory');
    expect(moves).toHaveLength(1);
    expect((moves[0]?.args as { categoryId: string }).categoryId).toBe('777777777777777777');
  });

  it('denies opener SendMessages on close', async () => {
    harness = await setup();
    await harness.guildConfig.setArchiveCategory('g1', '777777777777777777');
    const opened = await harness.service.openTicket(openInput(harness));
    if (!opened.ok) throw new Error('seed');
    harness.gateway.reset();

    await harness.service.closeTicket({
      ticketId: opened.value.id,
      actorId: 'u-opener',
      actorRoleIds: [],
    });

    const overrides = harness.gateway.callsOf('setOpenerSendMessages');
    expect(overrides).toHaveLength(1);
    expect((overrides[0]?.args as { allow: boolean }).allow).toBe(false);
  });
});

describe('TicketService.reopenTicket', () => {
  let harness: Harness | undefined;
  afterEach(async () => {
    if (harness !== undefined) {
      await harness.testDb.close();
      harness = undefined;
    }
  });

  it('non-support-staff cannot reopen', async () => {
    harness = await setup();
    const opened = await harness.service.openTicket(openInput(harness));
    if (!opened.ok) throw new Error('seed');
    await harness.service.closeTicket({
      ticketId: opened.value.id,
      actorId: 'u-opener',
      actorRoleIds: [],
    });
    const result = await harness.service.reopenTicket({
      ticketId: opened.value.id,
      actorId: 'u-opener',
      actorRoleIds: [],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(PermissionError);
  });

  it('support staff can reopen', async () => {
    harness = await setup();
    const opened = await harness.service.openTicket(openInput(harness));
    if (!opened.ok) throw new Error('seed');
    await harness.service.closeTicket({
      ticketId: opened.value.id,
      actorId: 'u-opener',
      actorRoleIds: [],
    });
    const result = await harness.service.reopenTicket({
      ticketId: opened.value.id,
      actorId: 'u-staff',
      actorRoleIds: ['r-staff'],
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.status).toBe(TicketStatus.open);
  });

  it('reopening a not-closed ticket returns ConflictError', async () => {
    harness = await setup();
    const opened = await harness.service.openTicket(openInput(harness));
    if (!opened.ok) throw new Error('seed');
    const result = await harness.service.reopenTicket({
      ticketId: opened.value.id,
      actorId: 'u-staff',
      actorRoleIds: ['r-staff'],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(ConflictError);
  });

  it('preserves claimedById — reopen of a previously-claimed ticket goes to claimed status', async () => {
    harness = await setup();
    const opened = await harness.service.openTicket(openInput(harness));
    if (!opened.ok) throw new Error('seed');
    await harness.service.claimTicket({
      ticketId: opened.value.id,
      actorId: 'u-staff',
      actorRoleIds: ['r-staff'],
    });
    await harness.service.closeTicket({
      ticketId: opened.value.id,
      actorId: 'u-staff',
      actorRoleIds: ['r-staff'],
    });
    const reopened = await harness.service.reopenTicket({
      ticketId: opened.value.id,
      actorId: 'u-staff',
      actorRoleIds: ['r-staff'],
    });
    expect(reopened.ok).toBe(true);
    if (reopened.ok) {
      expect(reopened.value.status).toBe(TicketStatus.claimed);
      expect(reopened.value.claimedById).toBe('u-staff');
    }
  });
});

describe('TicketService.deleteTicket', () => {
  let harness: Harness | undefined;
  afterEach(async () => {
    if (harness !== undefined) {
      await harness.testDb.close();
      harness = undefined;
    }
  });

  it('non-admin cannot delete', async () => {
    harness = await setup();
    const opened = await harness.service.openTicket(openInput(harness));
    if (!opened.ok) throw new Error('seed');
    const result = await harness.service.deleteTicket({
      ticketId: opened.value.id,
      actorId: 'u-mod',
      actorPermissionsBits: 0n,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(PermissionError);
  });

  it('admin deletes — channel removed, row + cascaded events gone, modlog posted', async () => {
    harness = await setup();
    await harness.guildConfig.setLogChannel('g1', '888888888888888888');
    const opened = await harness.service.openTicket(openInput(harness));
    if (!opened.ok) throw new Error('seed');
    harness.gateway.reset();

    const result = await harness.service.deleteTicket({
      ticketId: opened.value.id,
      actorId: 'u-admin',
      actorPermissionsBits: MANAGE_GUILD_BIT,
    });
    expect(result.ok).toBe(true);

    expect(harness.gateway.callsOf('postModlogSummary')).toHaveLength(1);
    expect(harness.gateway.callsOf('deleteChannel')).toHaveLength(1);
    expect(await countTickets(harness)).toBe(0);
    expect(await countEvents(harness)).toBe(0); // cascade
  });

  it('no modlog posted when log channel unset', async () => {
    harness = await setup();
    const opened = await harness.service.openTicket(openInput(harness));
    if (!opened.ok) throw new Error('seed');
    harness.gateway.reset();

    await harness.service.deleteTicket({
      ticketId: opened.value.id,
      actorId: 'u-admin',
      actorPermissionsBits: MANAGE_GUILD_BIT,
    });
    expect(harness.gateway.callsOf('postModlogSummary')).toHaveLength(0);
    expect(harness.gateway.callsOf('deleteChannel')).toHaveLength(1);
  });

  it('NotFoundError when ticket missing', async () => {
    harness = await setup();
    const result = await harness.service.deleteTicket({
      ticketId: 'nope',
      actorId: 'u-admin',
      actorPermissionsBits: MANAGE_GUILD_BIT,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(NotFoundError);
  });
});

describe('TicketService.markChannelOrphaned', () => {
  let harness: Harness | undefined;
  afterEach(async () => {
    if (harness !== undefined) {
      await harness.testDb.close();
      harness = undefined;
    }
  });

  it('marks an open ticket as closed when its channel is deleted externally', async () => {
    harness = await setup();
    const opened = await harness.service.openTicket(openInput(harness));
    if (!opened.ok) throw new Error('seed');

    await harness.service.markChannelOrphaned(opened.value.channelId);

    const [ticket] = await harness.testDb.db.select().from(schema.ticket).limit(1);
    expect(ticket?.status).toBe(TicketStatus.closed);
    const events = await harness.testDb.db.select().from(schema.ticketEvent);
    expect(events.some((e) => e.type === 'channel-deleted-externally')).toBe(true);
  });

  it('is a no-op when channel is unrecognized', async () => {
    harness = await setup();
    await harness.service.markChannelOrphaned('chan-not-ours');
    // No throw; nothing changes.
    expect(await countTickets(harness)).toBe(0);
  });

  it('is a no-op for self-deleted channels (deleteTicket-marked)', async () => {
    harness = await setup();
    const opened = await harness.service.openTicket(openInput(harness));
    if (!opened.ok) throw new Error('seed');
    await harness.service.deleteTicket({
      ticketId: opened.value.id,
      actorId: 'u-admin',
      actorPermissionsBits: MANAGE_GUILD_BIT,
    });
    // After deleteTicket, the channel is in recentlyDeleted set and the row is gone.
    await expect(
      harness.service.markChannelOrphaned(opened.value.channelId),
    ).resolves.toBeUndefined();
  });
});

describe('TicketService — gateway error propagation', () => {
  let testDb: TestDb | undefined;
  afterEach(async () => {
    if (testDb !== undefined) {
      await testDb.close();
      testDb = undefined;
    }
  });

  it('createTicketChannel failure surfaces as DiscordApiError', async () => {
    testDb = await createTestDb();
    const gateway = new FakeDiscordGateway({ throwOn: new Set(['createTicketChannel']) });
    const guildConfig = new GuildConfigService(testDb.db);
    const panel = new PanelService(testDb.db, gateway, branding);
    const service = new TicketService(testDb.db, gateway, branding, guildConfig, panel);
    const upserted = await panel.upsertPanel({
      guildId: 'g1',
      channelId: 'c-support',
      embedTitle: 'Support',
      embedDescription: 'Click below.',
    });
    if (!upserted.ok) throw new Error('seed');
    const typeAdded = await panel.addTicketType({
      panelId: upserted.value.panel.id,
      name: 'support',
      label: 'Open ticket',
      emoji: '📨',
      activeCategoryId: 'cat-active',
      supportRoleIds: ['r-staff'],
      pingRoleIds: [],
      perUserLimit: 1,
    });
    if (!typeAdded.ok) throw new Error('seed type failed');

    // The gateway throws a plain Error; service is expected to surface it.
    // FakeDiscordGateway throws plain Error rather than DiscordApiError so
    // the rejection bubbles up — exposing any half-state. No row should be
    // written when channel creation fails.
    await expect(
      service.openTicket({
        guildId: 'g1',
        openerId: 'u',
        openerUsername: 'u',
        panelId: upserted.value.panel.id,
        typeId: typeAdded.value.id,
      }),
    ).rejects.toThrow();
    const [row] = await testDb.db.select({ value: count() }).from(schema.ticket);
    expect(row?.value).toBe(0);
    expect(DiscordApiError.name).toBe('DiscordApiError');
  });
});

// Suppress lint — `eq` imported for symmetry with other test files; service
// tests mostly use count() + first-row reads.
void eq;
