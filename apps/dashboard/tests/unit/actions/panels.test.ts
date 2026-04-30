import { count, eq, schema } from '@hearth/database';
import { DiscordApiError, NotFoundError, ok } from '@hearth/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setupTestDb, type DashboardTestDb } from '../../helpers/testDb.js';

import { createPanel, deletePanel, retrySyncPanel, updatePanel } from '@/actions/panels';

const botClientMock = vi.hoisted(() => ({
  callBot: vi.fn(),
}));

vi.mock('@/lib/botClient', () => botClientMock);

const authMock = vi.hoisted(() => ({
  authorizeGuild: vi.fn(),
}));

vi.mock('@/lib/server-auth', () => authMock);

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

// Branding module imports env which validates at load. Mock it to keep
// tests independent of process.env state.
vi.mock('@/config/branding', () => ({
  branding: { name: 'TestBot', color: 0x5865f2, locale: 'en' },
  brandColorCss: () => '#5865F2',
}));

const guildId = '111111111111111111';
const channelId = '222222222222222222';

describe('createPanel', () => {
  let testDb: DashboardTestDb;

  beforeEach(async () => {
    testDb = await setupTestDb();
    authMock.authorizeGuild.mockResolvedValue(ok({ userId: 'u1', username: 'tester' }));
  });

  afterEach(async () => {
    await testDb.close();
    vi.clearAllMocks();
  });

  it('creates a DB row, calls bot render, and returns success', async () => {
    botClientMock.callBot.mockResolvedValue(ok({ messageId: 'm1', recreated: true }));

    const result = await createPanel({
      guildId,
      input: { guildId, channelId, embedTitle: 'Contact Team', embedDescription: 'Pick a button.' },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.discordSyncFailed).toBe(false);
    const [row] = await testDb.db
      .select()
      .from(schema.panel)
      .where(eq(schema.panel.id, result.value.value.panelId))
      .limit(1);
    expect(row?.embedTitle).toBe('Contact Team');
    expect(row?.embedDescription).toBe('Pick a button.');
    expect(botClientMock.callBot).toHaveBeenCalledWith(
      expect.objectContaining({
        path: `/internal/panels/${result.value.value.panelId}/render`,
        method: 'POST',
      }),
    );
  });

  it('flags discordSyncFailed when bot is unreachable but keeps the DB row', async () => {
    botClientMock.callBot.mockResolvedValue({
      ok: false,
      error: new DiscordApiError('bot unreachable'),
    });
    const result = await createPanel({ guildId, input: { guildId, channelId } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.discordSyncFailed).toBe(true);
    expect(result.value.discordSyncMessage).toMatch(/unreachable/);
    const [counted] = await testDb.db.select({ value: count() }).from(schema.panel);
    expect(counted?.value).toBe(1);
  });

  it('rejects when guildId in form does not match URL', async () => {
    const result = await createPanel({
      guildId,
      input: { guildId: '999999999999999999', channelId },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toMatch(/guildId in form does not match URL/);
    const [counted] = await testDb.db.select({ value: count() }).from(schema.panel);
    expect(counted?.value).toBe(0);
  });

  it('rejects unauthorized callers without touching the DB', async () => {
    authMock.authorizeGuild.mockResolvedValue({
      ok: false,
      error: new DiscordApiError('Manage Guild permission required'),
    });
    const result = await createPanel({ guildId, input: { guildId, channelId } });
    expect(result.ok).toBe(false);
    const [counted] = await testDb.db.select({ value: count() }).from(schema.panel);
    expect(counted?.value).toBe(0);
  });
});

describe('updatePanel', () => {
  let testDb: DashboardTestDb;
  let panelId: string;

  beforeEach(async () => {
    testDb = await setupTestDb();
    authMock.authorizeGuild.mockResolvedValue(ok({ userId: 'u1', username: 'tester' }));
    botClientMock.callBot.mockResolvedValue(ok({ messageId: 'm-init', recreated: true }));
    const initial = await createPanel({
      guildId,
      input: { guildId, channelId, embedTitle: 'Original', embedDescription: 'Original body' },
    });
    if (!initial.ok) throw new Error('seed');
    panelId = initial.value.value.panelId;
    botClientMock.callBot.mockClear();
  });

  afterEach(async () => {
    await testDb.close();
    vi.clearAllMocks();
  });

  it('updates DB and triggers render', async () => {
    botClientMock.callBot.mockResolvedValue(ok({ messageId: 'm9', recreated: false }));
    const result = await updatePanel({
      guildId,
      panelId,
      embedTitle: 'New title',
      embedDescription: 'New body',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.value.messageId).toBe('m9');
    const [row] = await testDb.db
      .select()
      .from(schema.panel)
      .where(eq(schema.panel.id, panelId))
      .limit(1);
    expect(row?.embedTitle).toBe('New title');
    expect(row?.embedDescription).toBe('New body');
  });

  it('skips fields the form left undefined', async () => {
    botClientMock.callBot.mockResolvedValue(ok({ messageId: 'm9', recreated: false }));
    await updatePanel({
      guildId,
      panelId,
      embedTitle: undefined,
      embedDescription: 'only body',
    });
    const [row] = await testDb.db
      .select()
      .from(schema.panel)
      .where(eq(schema.panel.id, panelId))
      .limit(1);
    // embedTitle untouched (kept seed value); embedDescription updated.
    expect(row?.embedTitle).toBe('Original');
    expect(row?.embedDescription).toBe('only body');
  });
});

describe('deletePanel', () => {
  let testDb: DashboardTestDb;

  beforeEach(async () => {
    testDb = await setupTestDb();
    authMock.authorizeGuild.mockResolvedValue(ok({ userId: 'u1', username: 'tester' }));
  });

  afterEach(async () => {
    await testDb.close();
    vi.clearAllMocks();
  });

  it('returns ok on successful delete', async () => {
    botClientMock.callBot.mockResolvedValue(ok({ deleted: true, panelId: 'p1' }));
    const result = await deletePanel({ guildId, panelId: 'p1' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.value.panelId).toBe('p1');
  });

  it('propagates NotFoundError from the bot', async () => {
    botClientMock.callBot.mockResolvedValue({
      ok: false,
      error: new NotFoundError('Panel not found'),
    });
    const result = await deletePanel({ guildId, panelId: 'missing' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NOT_FOUND');
  });
});

describe('retrySyncPanel', () => {
  let testDb: DashboardTestDb;

  beforeEach(async () => {
    testDb = await setupTestDb();
    authMock.authorizeGuild.mockResolvedValue(ok({ userId: 'u1', username: 'tester' }));
  });

  afterEach(async () => {
    await testDb.close();
    vi.clearAllMocks();
  });

  it('reports success when bot renders OK', async () => {
    botClientMock.callBot.mockResolvedValue(ok({ messageId: 'm-fresh', recreated: true }));
    const result = await retrySyncPanel({ guildId, panelId: 'p1' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.discordSyncFailed).toBe(false);
  });

  it('reports discordSyncFailed when bot still unreachable', async () => {
    botClientMock.callBot.mockResolvedValue({
      ok: false,
      error: new DiscordApiError('still down'),
    });
    const result = await retrySyncPanel({ guildId, panelId: 'p1' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.discordSyncFailed).toBe(true);
  });
});
