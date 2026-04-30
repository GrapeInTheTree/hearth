import { eq, schema } from '@hearth/database';
import { ok } from '@hearth/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setupTestDb, type DashboardTestDb } from '../../helpers/testDb.js';

import { setArchiveCategory, setLogChannel } from '@/actions/guild-config';

const authMock = vi.hoisted(() => ({
  authorizeGuild: vi.fn(),
}));
vi.mock('@/lib/server-auth', () => authMock);

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const guildId = '111111111111111111';
const validSnowflake = '222222222222222222';

describe('setArchiveCategory', () => {
  let testDb: DashboardTestDb;

  beforeEach(async () => {
    testDb = await setupTestDb();
    authMock.authorizeGuild.mockResolvedValue(ok({ userId: 'u1', username: 'tester' }));
  });

  afterEach(async () => {
    await testDb.close();
    vi.clearAllMocks();
  });

  it('upserts the archive category id', async () => {
    const result = await setArchiveCategory({ guildId, categoryId: validSnowflake });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.archiveCategoryId).toBe(validSnowflake);

    const [row] = await testDb.db
      .select()
      .from(schema.guildConfig)
      .where(eq(schema.guildConfig.guildId, guildId))
      .limit(1);
    expect(row?.archiveCategoryId).toBe(validSnowflake);
  });

  it('clears the archive category when null is passed', async () => {
    // Pre-set so we can verify the clear.
    await setArchiveCategory({ guildId, categoryId: validSnowflake });
    const result = await setArchiveCategory({ guildId, categoryId: null });
    expect(result.ok).toBe(true);
    const [row] = await testDb.db
      .select()
      .from(schema.guildConfig)
      .where(eq(schema.guildConfig.guildId, guildId))
      .limit(1);
    expect(row?.archiveCategoryId).toBeNull();
  });

  it('rejects malformed snowflakes', async () => {
    const result = await setArchiveCategory({ guildId, categoryId: 'not-a-snowflake' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('VALIDATION_ERROR');
    // No row written.
    const [row] = await testDb.db
      .select()
      .from(schema.guildConfig)
      .where(eq(schema.guildConfig.guildId, guildId))
      .limit(1);
    expect(row).toBeUndefined();
  });

  it('treats empty string as clear', async () => {
    const result = await setArchiveCategory({ guildId, categoryId: '' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.archiveCategoryId).toBeNull();
  });
});

describe('setLogChannel', () => {
  let testDb: DashboardTestDb;

  beforeEach(async () => {
    testDb = await setupTestDb();
    authMock.authorizeGuild.mockResolvedValue(ok({ userId: 'u1', username: 'tester' }));
  });

  afterEach(async () => {
    await testDb.close();
    vi.clearAllMocks();
  });

  it('upserts the alert channel id', async () => {
    const result = await setLogChannel({ guildId, channelId: validSnowflake });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.alertChannelId).toBe(validSnowflake);
    const [row] = await testDb.db
      .select()
      .from(schema.guildConfig)
      .where(eq(schema.guildConfig.guildId, guildId))
      .limit(1);
    expect(row?.alertChannelId).toBe(validSnowflake);
  });

  it('rejects malformed snowflakes', async () => {
    const result = await setLogChannel({ guildId, channelId: 'bad' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('VALIDATION_ERROR');
  });
});
