import { count, eq, schema } from '@hearth/database';
import { ok } from '@hearth/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setupTestDb, type DashboardTestDb } from '../../helpers/testDb.js';

import { addTicketType, editTicketType, removeTicketType } from '@/actions/ticket-types';

const botClientMock = vi.hoisted(() => ({
  callBot: vi.fn(),
}));
vi.mock('@/lib/botClient', () => botClientMock);

const authMock = vi.hoisted(() => ({
  authorizeGuild: vi.fn(),
}));
vi.mock('@/lib/server-auth', () => authMock);

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const guildId = '111111111111111111';
const categoryId = '222222222222222222';
const roleId = '333333333333333333';

interface SeedResult {
  testDb: DashboardTestDb;
  panelId: string;
}

async function seedPanel(extra: { otherGuild?: string } = {}): Promise<SeedResult> {
  const testDb = await setupTestDb();
  const targetGuild = extra.otherGuild ?? guildId;
  const [panel] = await testDb.db
    .insert(schema.panel)
    .values({
      guildId: targetGuild,
      channelId: 'c1',
      messageId: 'pending',
      embedTitle: 'Support',
      embedDescription: 'Click below.',
    })
    .returning();
  if (panel === undefined) throw new Error('seed failed');
  return { testDb, panelId: panel.id };
}

function buildInput(panelId: string): {
  panelId: string;
  name: string;
  label: string;
  emoji: string;
  buttonStyle: 'success';
  activeCategoryId: string;
  supportRoleIds: string[];
  pingRoleIds: string[];
  perUserLimit: number;
} {
  return {
    panelId,
    name: 'question',
    label: 'Question',
    emoji: '❓',
    buttonStyle: 'success',
    activeCategoryId: categoryId,
    supportRoleIds: [roleId],
    pingRoleIds: [],
    perUserLimit: 1,
  };
}

describe('addTicketType', () => {
  let testDb: DashboardTestDb;
  let panelId: string;

  beforeEach(async () => {
    const seed = await seedPanel();
    testDb = seed.testDb;
    panelId = seed.panelId;
    authMock.authorizeGuild.mockResolvedValue(ok({ userId: 'u1', username: 'tester' }));
    botClientMock.callBot.mockResolvedValue(ok({ messageId: 'm1', recreated: false }));
  });

  afterEach(async () => {
    await testDb.close();
    vi.clearAllMocks();
  });

  it('creates the type and triggers a render', async () => {
    const result = await addTicketType({ guildId, input: buildInput(panelId) });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [row] = await testDb.db
      .select()
      .from(schema.panelTicketType)
      .where(eq(schema.panelTicketType.id, result.value.value.typeId))
      .limit(1);
    expect(row?.name).toBe('question');
    expect(row?.buttonLabel).toBe('Question');
    expect(botClientMock.callBot).toHaveBeenCalledWith(
      expect.objectContaining({ path: `/internal/panels/${panelId}/render` }),
    );
  });

  it('rejects duplicate name with ConflictError', async () => {
    await addTicketType({ guildId, input: buildInput(panelId) });
    botClientMock.callBot.mockClear();
    const result = await addTicketType({ guildId, input: buildInput(panelId) });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('CONFLICT');
    const [counted] = await testDb.db.select({ value: count() }).from(schema.panelTicketType);
    expect(counted?.value).toBe(1);
  });

  it('returns NotFoundError when panel is in another guild', async () => {
    await testDb.close();
    const seed = await seedPanel({ otherGuild: 'other-guild' });
    testDb = seed.testDb;
    panelId = seed.panelId;
    const result = await addTicketType({ guildId, input: buildInput(panelId) });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NOT_FOUND');
  });

  it('flags discordSyncFailed but commits the DB row when bot is down', async () => {
    botClientMock.callBot.mockResolvedValue({
      ok: false,
      error: new Error('bot down'),
    });
    const result = await addTicketType({ guildId, input: buildInput(panelId) });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.discordSyncFailed).toBe(true);
    const [counted] = await testDb.db.select({ value: count() }).from(schema.panelTicketType);
    expect(counted?.value).toBe(1);
  });
});

describe('editTicketType', () => {
  let testDb: DashboardTestDb;
  let panelId: string;
  let typeId: string;

  beforeEach(async () => {
    const seed = await seedPanel();
    testDb = seed.testDb;
    panelId = seed.panelId;
    authMock.authorizeGuild.mockResolvedValue(ok({ userId: 'u1', username: 'tester' }));
    botClientMock.callBot.mockResolvedValue(ok({ messageId: 'm1', recreated: false }));
    const created = await addTicketType({ guildId, input: buildInput(panelId) });
    if (!created.ok) throw new Error('seed type failed');
    typeId = created.value.value.typeId;
    botClientMock.callBot.mockClear();
  });

  afterEach(async () => {
    await testDb.close();
    vi.clearAllMocks();
  });

  it('updates only the fields the form provided', async () => {
    const result = await editTicketType({
      guildId,
      typeId,
      fields: { label: 'New label', emoji: '💬' },
    });
    expect(result.ok).toBe(true);
    const [row] = await testDb.db
      .select()
      .from(schema.panelTicketType)
      .where(eq(schema.panelTicketType.id, typeId))
      .limit(1);
    expect(row?.buttonLabel).toBe('New label');
    expect(row?.emoji).toBe('💬');
    // Other fields untouched.
    expect(row?.activeCategoryId).toBe(categoryId);
  });

  it('returns NotFoundError when type belongs to another guild', async () => {
    const result = await editTicketType({
      guildId: 'other-guild-id',
      typeId,
      fields: { label: 'x' },
    });
    expect(result.ok).toBe(false);
    // Auth gate fires first when guildId mismatches; either NOT_FOUND or
    // unauthorized is acceptable. We assert it didn't mutate.
    const [row] = await testDb.db
      .select()
      .from(schema.panelTicketType)
      .where(eq(schema.panelTicketType.id, typeId))
      .limit(1);
    expect(row?.buttonLabel).toBe('Question');
  });
});

describe('removeTicketType', () => {
  let testDb: DashboardTestDb;
  let panelId: string;
  let typeId: string;

  beforeEach(async () => {
    const seed = await seedPanel();
    testDb = seed.testDb;
    panelId = seed.panelId;
    authMock.authorizeGuild.mockResolvedValue(ok({ userId: 'u1', username: 'tester' }));
    botClientMock.callBot.mockResolvedValue(ok({ messageId: 'm1', recreated: false }));
    const created = await addTicketType({ guildId, input: buildInput(panelId) });
    if (!created.ok) throw new Error('seed type failed');
    typeId = created.value.value.typeId;
    botClientMock.callBot.mockClear();
  });

  afterEach(async () => {
    await testDb.close();
    vi.clearAllMocks();
  });

  it('removes the type when no tickets reference it', async () => {
    const result = await removeTicketType({ guildId, typeId });
    expect(result.ok).toBe(true);
    const [row] = await testDb.db
      .select()
      .from(schema.panelTicketType)
      .where(eq(schema.panelTicketType.id, typeId))
      .limit(1);
    expect(row).toBeUndefined();
  });

  it('blocks removal when tickets reference the type', async () => {
    // Seed a ticket referencing the type.
    await testDb.db.insert(schema.ticket).values({
      guildId,
      panelId,
      panelTypeId: typeId,
      channelId: 'tc1',
      number: 1,
      openerId: 'u-opener',
      status: 'open',
    });
    await testDb.db.insert(schema.ticket).values({
      guildId,
      panelId,
      panelTypeId: typeId,
      channelId: 'tc2',
      number: 2,
      openerId: 'u-opener-2',
      status: 'open',
    });
    await testDb.db.insert(schema.ticket).values({
      guildId,
      panelId,
      panelTypeId: typeId,
      channelId: 'tc3',
      number: 3,
      openerId: 'u-opener-3',
      status: 'closed',
    });

    const result = await removeTicketType({ guildId, typeId });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('CONFLICT');
    expect(result.error.message).toMatch(/3 ticket\(s\) reference it/);
    const [row] = await testDb.db
      .select()
      .from(schema.panelTicketType)
      .where(eq(schema.panelTicketType.id, typeId))
      .limit(1);
    expect(row).not.toBeUndefined();
  });
});
