import { DiscordApiError, NotFoundError, ok } from '@discord-bot/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createPanel, deletePanel, retrySyncPanel, updatePanel } from '@/actions/panels';

// vi.mock calls are hoisted by Vitest's compiler to before the imports
// above, so the typed imports of the actions module above will see the
// mocked `db` / `callBot` / `authorizeGuild` / `next/cache` exports.
const dbMock = vi.hoisted(() => ({
  panel: {
    create: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock('@discord-bot/database', () => ({
  db: dbMock,
  TicketStatus: { open: 'open', claimed: 'claimed', closed: 'closed' },
  Prisma: {},
}));

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

beforeEach(() => {
  authMock.authorizeGuild.mockResolvedValue(ok({ userId: 'u1', username: 'tester' }));
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('createPanel', () => {
  it('creates a DB row, calls bot render, and returns success', async () => {
    dbMock.panel.create.mockResolvedValue({
      id: 'p1',
      messageId: 'pending',
      embedTitle: 'Contact Team',
      embedDescription: 'Pick a button.',
    });
    botClientMock.callBot.mockResolvedValue(ok({ messageId: 'm1', recreated: true }));

    const result = await createPanel({
      guildId,
      input: { guildId, channelId, embedTitle: 'Contact Team', embedDescription: 'Pick a button.' },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.value.panelId).toBe('p1');
    expect(result.value.discordSyncFailed).toBe(false);
    expect(dbMock.panel.create).toHaveBeenCalledOnce();
    expect(botClientMock.callBot).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/internal/panels/p1/render', method: 'POST' }),
    );
  });

  it('flags discordSyncFailed when bot is unreachable but keeps the DB row', async () => {
    dbMock.panel.create.mockResolvedValue({ id: 'p2', messageId: 'pending' });
    botClientMock.callBot.mockResolvedValue({
      ok: false,
      error: new DiscordApiError('bot unreachable'),
    });
    const result = await createPanel({
      guildId,
      input: { guildId, channelId },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.discordSyncFailed).toBe(true);
    expect(result.value.discordSyncMessage).toMatch(/unreachable/);
    expect(dbMock.panel.create).toHaveBeenCalledOnce();
  });

  it('rejects when guildId in form does not match URL', async () => {
    const result = await createPanel({
      guildId,
      input: { guildId: '999999999999999999', channelId },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toMatch(/guildId in form does not match URL/);
    expect(dbMock.panel.create).not.toHaveBeenCalled();
  });

  it('rejects unauthorized callers without touching the DB', async () => {
    authMock.authorizeGuild.mockResolvedValue({
      ok: false,
      error: new DiscordApiError('Manage Guild permission required'),
    });
    const result = await createPanel({
      guildId,
      input: { guildId, channelId },
    });
    expect(result.ok).toBe(false);
    expect(dbMock.panel.create).not.toHaveBeenCalled();
  });
});

describe('updatePanel', () => {
  it('updates DB and triggers render', async () => {
    dbMock.panel.update.mockResolvedValue({});
    botClientMock.callBot.mockResolvedValue(ok({ messageId: 'm9', recreated: false }));
    const result = await updatePanel({
      guildId,
      panelId: 'p1',
      embedTitle: 'New title',
      embedDescription: 'New body',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.value.messageId).toBe('m9');
    expect(dbMock.panel.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { embedTitle: 'New title', embedDescription: 'New body' },
    });
  });

  it('skips fields the form left undefined', async () => {
    dbMock.panel.update.mockResolvedValue({});
    botClientMock.callBot.mockResolvedValue(ok({ messageId: 'm9', recreated: false }));
    await updatePanel({
      guildId,
      panelId: 'p1',
      embedTitle: undefined,
      embedDescription: 'only body',
    });
    expect(dbMock.panel.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { embedDescription: 'only body' },
    });
  });
});

describe('deletePanel', () => {
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
    expect(result.error).toBeInstanceOf(NotFoundError);
  });
});

describe('retrySyncPanel', () => {
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
