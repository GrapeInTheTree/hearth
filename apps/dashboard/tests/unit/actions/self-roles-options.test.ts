import { eq, schema } from '@hearth/database';
import { ok } from '@hearth/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setupTestDb, type DashboardTestDb } from '../../helpers/testDb.js';

import {
  addSelfRolesOption,
  removeSelfRolesOption,
  updateSelfRolesOption,
} from '@/actions/self-roles-options';

const botClientMock = vi.hoisted(() => ({ callBot: vi.fn() }));
vi.mock('@/lib/botClient', () => botClientMock);

const authMock = vi.hoisted(() => ({ authorizeGuild: vi.fn() }));
vi.mock('@/lib/server-auth', () => authMock);

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const guildId = '111111111111111111';
const channelId = '222222222222222222';
const roleA = '333333333333333331';
const roleB = '333333333333333332';

async function seedPanelWithOption(
  testDb: DashboardTestDb,
): Promise<{ panelId: string; optionId: string }> {
  const [panel] = await testDb.db
    .insert(schema.selfRolesPanel)
    .values({
      guildId,
      channelId,
      messageId: 'msg-1',
      embedTitle: 'Languages',
      embedDescription: 'Pick the flags.',
    })
    .returning();
  if (panel === undefined) throw new Error('panel seed failed');
  const [option] = await testDb.db
    .insert(schema.selfRolesOption)
    .values({
      panelId: panel.id,
      label: 'English',
      emoji: '🇺🇸',
      roleId: roleA,
      position: 0,
    })
    .returning();
  if (option === undefined) throw new Error('option seed failed');
  return { panelId: panel.id, optionId: option.id };
}

describe('addSelfRolesOption', () => {
  let testDb: DashboardTestDb;
  let panelId: string;

  beforeEach(async () => {
    testDb = await setupTestDb();
    authMock.authorizeGuild.mockResolvedValue(ok({ userId: 'u1', username: 'tester' }));
    botClientMock.callBot.mockResolvedValue(ok({ messageId: 'msg-1', recreated: false }));
    const seeded = await seedPanelWithOption(testDb);
    panelId = seeded.panelId;
  });
  afterEach(async () => {
    await testDb.close();
    vi.clearAllMocks();
  });

  it('adds a second option with a different emoji and auto-syncs to Discord', async () => {
    const result = await addSelfRolesOption({
      guildId,
      panelId,
      input: {
        label: 'Korean',
        emoji: '🇰🇷',
        roleId: roleB,
        position: 1,
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.discordSyncFailed).toBe(false);
    const rows = await testDb.db
      .select()
      .from(schema.selfRolesOption)
      .where(eq(schema.selfRolesOption.panelId, panelId));
    expect(rows).toHaveLength(2);
    // The fix: option add must auto-push to the live message, otherwise
    // operators are forced to manually repost (which wipes user reactions).
    expect(botClientMock.callBot).toHaveBeenCalledWith(
      expect.objectContaining({ path: `/internal/self-roles/${panelId}/render` }),
    );
  });

  it('flags discordSyncFailed when the bot is unreachable but keeps the DB row', async () => {
    botClientMock.callBot.mockResolvedValue({
      ok: false,
      error: { code: 'DISCORD_API_ERROR', message: 'bot down' },
    });
    const result = await addSelfRolesOption({
      guildId,
      panelId,
      input: {
        label: 'Japanese',
        emoji: '🇯🇵',
        roleId: roleB,
        position: 2,
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.discordSyncFailed).toBe(true);
    const rows = await testDb.db
      .select()
      .from(schema.selfRolesOption)
      .where(eq(schema.selfRolesOption.panelId, panelId));
    expect(rows).toHaveLength(2);
  });

  it('rejects a duplicate emoji on the same panel', async () => {
    const result = await addSelfRolesOption({
      guildId,
      panelId,
      input: {
        label: 'English (US)',
        emoji: '🇺🇸',
        roleId: roleB,
        position: 1,
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('CONFLICT');
  });

  it('rejects a duplicate position on the same panel', async () => {
    const result = await addSelfRolesOption({
      guildId,
      panelId,
      input: {
        label: 'Korean',
        emoji: '🇰🇷',
        roleId: roleB,
        position: 0,
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('CONFLICT');
  });

  it('rejects when the parent panel is in a different guild', async () => {
    const result = await addSelfRolesOption({
      guildId: '999999999999999999',
      panelId,
      input: { label: 'X', emoji: '🇯🇵', roleId: roleB, position: 2 },
    });
    expect(result.ok).toBe(false);
  });
});

describe('updateSelfRolesOption', () => {
  let testDb: DashboardTestDb;
  let panelId: string;
  let optionId: string;

  beforeEach(async () => {
    testDb = await setupTestDb();
    authMock.authorizeGuild.mockResolvedValue(ok({ userId: 'u1', username: 'tester' }));
    botClientMock.callBot.mockResolvedValue(ok({ messageId: 'msg-1', recreated: false }));
    const seeded = await seedPanelWithOption(testDb);
    panelId = seeded.panelId;
    optionId = seeded.optionId;
  });
  afterEach(async () => {
    await testDb.close();
    vi.clearAllMocks();
  });

  it('updates only the supplied fields', async () => {
    const result = await updateSelfRolesOption({
      guildId,
      panelId,
      optionId,
      input: { label: 'English (US)' },
    });
    expect(result.ok).toBe(true);
    const [row] = await testDb.db
      .select()
      .from(schema.selfRolesOption)
      .where(eq(schema.selfRolesOption.id, optionId));
    expect(row?.label).toBe('English (US)');
    expect(row?.emoji).toBe('🇺🇸');
  });

  it('returns NotFoundError when option is not on this panel', async () => {
    const result = await updateSelfRolesOption({
      guildId,
      panelId,
      optionId: 'does-not-exist',
      input: { label: 'X' },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NOT_FOUND');
  });
});

describe('removeSelfRolesOption', () => {
  let testDb: DashboardTestDb;
  let panelId: string;
  let optionId: string;

  beforeEach(async () => {
    testDb = await setupTestDb();
    authMock.authorizeGuild.mockResolvedValue(ok({ userId: 'u1', username: 'tester' }));
    botClientMock.callBot.mockResolvedValue(ok({ messageId: 'msg-1', recreated: false }));
    const seeded = await seedPanelWithOption(testDb);
    panelId = seeded.panelId;
    optionId = seeded.optionId;
  });
  afterEach(async () => {
    await testDb.close();
    vi.clearAllMocks();
  });

  it('deletes the option', async () => {
    const result = await removeSelfRolesOption({ guildId, panelId, optionId });
    expect(result.ok).toBe(true);
    const rows = await testDb.db
      .select()
      .from(schema.selfRolesOption)
      .where(eq(schema.selfRolesOption.id, optionId));
    expect(rows).toHaveLength(0);
  });
});
