import { ConflictError, NotFoundError, ok } from '@discord-bot/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { addTicketType, editTicketType, removeTicketType } from '@/actions/ticket-types';

const dbMock = vi.hoisted(() => ({
  panel: {
    findUnique: vi.fn(),
  },
  panelTicketType: {
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    findUnique: vi.fn(),
  },
  ticket: {
    count: vi.fn(),
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

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const guildId = '111111111111111111';
const panelId = 'panel-1';
const categoryId = '222222222222222222';
const roleId = '333333333333333333';

const validInput = {
  panelId,
  name: 'question',
  label: 'Question',
  emoji: '❓',
  buttonStyle: 'success' as const,
  activeCategoryId: categoryId,
  supportRoleIds: [roleId],
  pingRoleIds: [],
  perUserLimit: 1,
};

beforeEach(() => {
  authMock.authorizeGuild.mockResolvedValue(ok({ userId: 'u1', username: 'tester' }));
  botClientMock.callBot.mockResolvedValue(ok({ messageId: 'm1', recreated: false }));
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('addTicketType', () => {
  it('creates the type and triggers a render', async () => {
    dbMock.panel.findUnique.mockResolvedValue({
      id: panelId,
      guildId,
      ticketTypes: [],
    });
    dbMock.panelTicketType.create.mockResolvedValue({ id: 't1', panelId });

    const result = await addTicketType({ guildId, input: validInput });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.value.typeId).toBe('t1');
    expect(dbMock.panelTicketType.create).toHaveBeenCalledOnce();
    expect(botClientMock.callBot).toHaveBeenCalledWith(
      expect.objectContaining({ path: `/internal/panels/${panelId}/render` }),
    );
  });

  it('rejects duplicate name with ConflictError', async () => {
    dbMock.panel.findUnique.mockResolvedValue({
      id: panelId,
      guildId,
      ticketTypes: [{ name: 'question' }],
    });
    const result = await addTicketType({ guildId, input: validInput });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(ConflictError);
    expect(dbMock.panelTicketType.create).not.toHaveBeenCalled();
  });

  it('returns NotFoundError when panel is in another guild', async () => {
    dbMock.panel.findUnique.mockResolvedValue({
      id: panelId,
      guildId: 'other-guild',
      ticketTypes: [],
    });
    const result = await addTicketType({ guildId, input: validInput });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(NotFoundError);
  });

  it('flags discordSyncFailed but commits the DB row when bot is down', async () => {
    dbMock.panel.findUnique.mockResolvedValue({ id: panelId, guildId, ticketTypes: [] });
    dbMock.panelTicketType.create.mockResolvedValue({ id: 't1', panelId });
    botClientMock.callBot.mockResolvedValue({
      ok: false,
      error: new Error('bot down'),
    });
    const result = await addTicketType({ guildId, input: validInput });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.discordSyncFailed).toBe(true);
    expect(dbMock.panelTicketType.create).toHaveBeenCalledOnce();
  });
});

describe('editTicketType', () => {
  it('updates only the fields the form provided', async () => {
    dbMock.panelTicketType.findUnique.mockResolvedValue({
      id: 't1',
      panel: { id: panelId, guildId },
    });
    const result = await editTicketType({
      guildId,
      typeId: 't1',
      fields: { label: 'New label', emoji: '💬' },
    });
    expect(result.ok).toBe(true);
    expect(dbMock.panelTicketType.update).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: { buttonLabel: 'New label', emoji: '💬' },
    });
  });

  it('returns NotFoundError when type belongs to another guild', async () => {
    dbMock.panelTicketType.findUnique.mockResolvedValue({
      id: 't1',
      panel: { id: panelId, guildId: 'other-guild' },
    });
    const result = await editTicketType({
      guildId,
      typeId: 't1',
      fields: { label: 'x' },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(NotFoundError);
  });
});

describe('removeTicketType', () => {
  it('removes the type when no tickets reference it', async () => {
    dbMock.panelTicketType.findUnique.mockResolvedValue({
      id: 't1',
      name: 'question',
      panel: { id: panelId, guildId },
    });
    dbMock.ticket.count.mockResolvedValue(0);
    const result = await removeTicketType({ guildId, typeId: 't1' });
    expect(result.ok).toBe(true);
    expect(dbMock.panelTicketType.delete).toHaveBeenCalledWith({ where: { id: 't1' } });
  });

  it('blocks removal when tickets reference the type', async () => {
    dbMock.panelTicketType.findUnique.mockResolvedValue({
      id: 't1',
      name: 'question',
      panel: { id: panelId, guildId },
    });
    dbMock.ticket.count.mockResolvedValue(3);
    const result = await removeTicketType({ guildId, typeId: 't1' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(ConflictError);
    expect(result.error.message).toMatch(/3 ticket\(s\) reference it/);
    expect(dbMock.panelTicketType.delete).not.toHaveBeenCalled();
  });
});
