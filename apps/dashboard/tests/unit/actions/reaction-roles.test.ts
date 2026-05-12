import { eq, schema } from '@hearth/database';
import { ok } from '@hearth/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setupTestDb, type DashboardTestDb } from '../../helpers/testDb.js';

import {
  createReactionRolesPanel,
  deleteReactionRolesPanel,
  repostReactionRolesPanel,
  updateReactionRolesPanel,
} from '@/actions/reaction-roles';

const botClientMock = vi.hoisted(() => ({ callBot: vi.fn() }));
vi.mock('@/lib/botClient', () => botClientMock);

const authMock = vi.hoisted(() => ({ authorizeGuild: vi.fn() }));
vi.mock('@/lib/server-auth', () => authMock);

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const guildId = '111111111111111111';
const channelId = '222222222222222222';

async function seedPanel(testDb: DashboardTestDb): Promise<string> {
  const [panel] = await testDb.db
    .insert(schema.reactionRolesPanel)
    .values({
      guildId,
      channelId,
      messageId: 'pending',
      embedTitle: 'Languages',
      embedDescription: 'Pick the flags.',
    })
    .returning();
  if (panel === undefined) throw new Error('seed failed');
  return panel.id;
}

describe('createReactionRolesPanel', () => {
  let testDb: DashboardTestDb;
  beforeEach(async () => {
    testDb = await setupTestDb();
    authMock.authorizeGuild.mockResolvedValue(ok({ userId: 'u1', username: 'tester' }));
  });
  afterEach(async () => {
    await testDb.close();
    vi.clearAllMocks();
  });

  it('inserts a panel row with placeholder messageId', async () => {
    const result = await createReactionRolesPanel({
      guildId,
      input: {
        guildId,
        channelId,
        embedTitle: 'Languages',
        embedDescription: 'Pick the flags you read.',
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const rows = await testDb.db
      .select()
      .from(schema.reactionRolesPanel)
      .where(eq(schema.reactionRolesPanel.id, result.value.value.panelId));
    expect(rows[0]?.guildId).toBe(guildId);
    expect(rows[0]?.messageId).toBe('pending');
  });

  it('rejects unauthorized callers without writing to the DB', async () => {
    authMock.authorizeGuild.mockResolvedValue({
      ok: false,
      error: { code: 'PERMISSION_ERROR', message: 'forbidden' },
    });
    const result = await createReactionRolesPanel({
      guildId,
      input: { guildId, channelId, embedTitle: 'X', embedDescription: 'Y' },
    });
    expect(result.ok).toBe(false);
    const rows = await testDb.db
      .select()
      .from(schema.reactionRolesPanel)
      .where(eq(schema.reactionRolesPanel.guildId, guildId));
    expect(rows).toHaveLength(0);
  });

  it('rejects when guildId in form does not match URL', async () => {
    const result = await createReactionRolesPanel({
      guildId,
      input: {
        guildId: '999999999999999999',
        channelId,
        embedTitle: 'X',
        embedDescription: 'Y',
      },
    });
    expect(result.ok).toBe(false);
  });
});

describe('updateReactionRolesPanel', () => {
  let testDb: DashboardTestDb;
  let panelId: string;

  beforeEach(async () => {
    testDb = await setupTestDb();
    authMock.authorizeGuild.mockResolvedValue(ok({ userId: 'u1', username: 'tester' }));
    panelId = await seedPanel(testDb);
  });
  afterEach(async () => {
    await testDb.close();
    vi.clearAllMocks();
  });

  it('updates only the provided fields and triggers a render call', async () => {
    botClientMock.callBot.mockResolvedValue(ok({ messageId: 'msg-1', recreated: false }));
    const result = await updateReactionRolesPanel({
      guildId,
      panelId,
      channelId: undefined,
      embedTitle: 'New title',
      embedDescription: undefined,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.discordSyncFailed).toBe(false);
    const [row] = await testDb.db
      .select()
      .from(schema.reactionRolesPanel)
      .where(eq(schema.reactionRolesPanel.id, panelId));
    expect(row?.embedTitle).toBe('New title');
    expect(row?.embedDescription).toBe('Pick the flags.');
    expect(botClientMock.callBot).toHaveBeenCalledWith(
      expect.objectContaining({ path: `/internal/reaction-roles/${panelId}/render` }),
    );
  });

  it('flags discordSyncFailed when the bot returns an error', async () => {
    botClientMock.callBot.mockResolvedValue({
      ok: false,
      error: { code: 'DISCORD_API_ERROR', message: 'bot down' },
    });
    const result = await updateReactionRolesPanel({
      guildId,
      panelId,
      channelId: undefined,
      embedTitle: 'Whatever',
      embedDescription: undefined,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.discordSyncFailed).toBe(true);
    expect(result.value.discordSyncMessage).toBe('bot down');
  });
});

describe('deleteReactionRolesPanel', () => {
  let testDb: DashboardTestDb;
  let panelId: string;

  beforeEach(async () => {
    testDb = await setupTestDb();
    authMock.authorizeGuild.mockResolvedValue(ok({ userId: 'u1', username: 'tester' }));
    panelId = await seedPanel(testDb);
  });
  afterEach(async () => {
    await testDb.close();
    vi.clearAllMocks();
  });

  it('returns ok when the bot deletes the panel', async () => {
    botClientMock.callBot.mockResolvedValue(ok({ deleted: true, panelId }));
    const result = await deleteReactionRolesPanel({ guildId, panelId });
    expect(result.ok).toBe(true);
  });

  it('propagates NotFoundError from the bot', async () => {
    botClientMock.callBot.mockResolvedValue({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'gone' },
    });
    const result = await deleteReactionRolesPanel({ guildId, panelId });
    expect(result.ok).toBe(false);
  });
});

describe('repostReactionRolesPanel', () => {
  let testDb: DashboardTestDb;
  let panelId: string;

  beforeEach(async () => {
    testDb = await setupTestDb();
    authMock.authorizeGuild.mockResolvedValue(ok({ userId: 'u1', username: 'tester' }));
    panelId = await seedPanel(testDb);
  });
  afterEach(async () => {
    await testDb.close();
    vi.clearAllMocks();
  });

  it('reports the new messageId from the bot', async () => {
    botClientMock.callBot.mockResolvedValue(
      ok({ messageId: 'new-msg', previousMessageId: 'old-msg' }),
    );
    const result = await repostReactionRolesPanel({ guildId, panelId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.value.messageId).toBe('new-msg');
    expect(result.value.discordSyncFailed).toBe(false);
  });

  it('flags discordSyncFailed when the bot is unreachable', async () => {
    botClientMock.callBot.mockResolvedValue({
      ok: false,
      error: { code: 'DISCORD_API_ERROR', message: 'bot down' },
    });
    const result = await repostReactionRolesPanel({ guildId, panelId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.discordSyncFailed).toBe(true);
  });
});
