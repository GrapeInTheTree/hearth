import { ValidationError, ok } from '@discord-bot/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setArchiveCategory, setLogChannel } from '@/actions/guild-config';

const dbMock = vi.hoisted(() => ({
  guildConfig: {
    upsert: vi.fn(),
  },
}));

vi.mock('@discord-bot/database', () => ({
  db: dbMock,
  TicketStatus: { open: 'open', claimed: 'claimed', closed: 'closed' },
  Prisma: {},
}));

const authMock = vi.hoisted(() => ({
  authorizeGuild: vi.fn(),
}));
vi.mock('@/lib/server-auth', () => authMock);

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const guildId = '111111111111111111';
const validSnowflake = '222222222222222222';

beforeEach(() => {
  authMock.authorizeGuild.mockResolvedValue(ok({ userId: 'u1', username: 'tester' }));
  dbMock.guildConfig.upsert.mockResolvedValue({});
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('setArchiveCategory', () => {
  it('upserts the archive category id', async () => {
    const result = await setArchiveCategory({ guildId, categoryId: validSnowflake });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.archiveCategoryId).toBe(validSnowflake);
    expect(dbMock.guildConfig.upsert).toHaveBeenCalledWith({
      where: { guildId },
      create: { guildId, archiveCategoryId: validSnowflake },
      update: { archiveCategoryId: validSnowflake },
    });
  });

  it('clears the archive category when null is passed', async () => {
    const result = await setArchiveCategory({ guildId, categoryId: null });
    expect(result.ok).toBe(true);
    expect(dbMock.guildConfig.upsert).toHaveBeenCalledWith({
      where: { guildId },
      create: { guildId, archiveCategoryId: null },
      update: { archiveCategoryId: null },
    });
  });

  it('rejects malformed snowflakes', async () => {
    const result = await setArchiveCategory({ guildId, categoryId: 'not-a-snowflake' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(ValidationError);
    expect(dbMock.guildConfig.upsert).not.toHaveBeenCalled();
  });

  it('treats empty string as clear', async () => {
    const result = await setArchiveCategory({ guildId, categoryId: '' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.archiveCategoryId).toBeNull();
  });
});

describe('setLogChannel', () => {
  it('upserts the alert channel id', async () => {
    const result = await setLogChannel({ guildId, channelId: validSnowflake });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.alertChannelId).toBe(validSnowflake);
  });

  it('rejects malformed snowflakes', async () => {
    const result = await setLogChannel({ guildId, channelId: 'bad' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(ValidationError);
  });
});
