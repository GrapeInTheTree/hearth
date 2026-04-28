import type { ServerResponse } from 'node:http';

import { DiscordApiError, NotFoundError, err, ok } from '@hearth/shared';
import type { PanelService } from '@hearth/tickets-core';
import { ChannelType } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';

import { handleGuildResources, handleGuildsList } from '../../../src/internal-api/routes/guilds.js';
import { handleHealthz } from '../../../src/internal-api/routes/healthz.js';
import { handlePanelDelete, handlePanelRender } from '../../../src/internal-api/routes/panels.js';
import type { InternalApiContext } from '../../../src/internal-api/types.js';

interface FakeRes {
  status: number;
  body: unknown;
  headers: Record<string, string>;
}

function fakeRes(): FakeRes & ServerResponse {
  const captured: FakeRes = { status: 0, body: undefined, headers: {} };
  const res = {
    setHeader(name: string, value: string) {
      captured.headers[name] = value;
    },
    writeHead(status: number, headers: Record<string, string>) {
      captured.status = status;
      Object.assign(captured.headers, headers);
    },
    end(body: string) {
      captured.body = JSON.parse(body) as unknown;
    },
  } as unknown as FakeRes & ServerResponse;
  Object.assign(res, captured);
  // Bridge captured fields onto res for test reads.
  Object.defineProperties(res, {
    status: { get: () => captured.status },
    body: { get: () => captured.body },
    headers: { get: () => captured.headers },
  });
  return res;
}

function fakeContext(overrides: Partial<InternalApiContext> = {}): InternalApiContext {
  const branding = {
    name: 'TestBot',
    color: 0,
    iconUrl: undefined,
    footerText: undefined,
    supportUrl: undefined,
    locale: 'en' as const,
  };
  const guildsCache = new Map<string, unknown>();
  const baseCtx: InternalApiContext = {
    client: { guilds: { cache: guildsCache } } as unknown as InternalApiContext['client'],
    db: {} as InternalApiContext['db'],
    panel: {} as PanelService,
    branding,
    isReady: () => true,
  };
  return { ...baseCtx, ...overrides };
}

describe('GET /healthz', () => {
  it('200 + { ready: true } when client is ready', () => {
    const res = fakeRes();
    handleHealthz(fakeContext({ isReady: () => true }), res);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ready: true });
    expect(res.headers['Cache-Control']).toBe('no-store');
  });

  it('503 when not ready', () => {
    const res = fakeRes();
    handleHealthz(fakeContext({ isReady: () => false }), res);
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ ready: false });
  });
});

describe('GET /internal/guilds/list', () => {
  it('returns subset of bot-membered guilds with name + iconHash', () => {
    const guildsCache = new Map<string, { id: string; name: string; icon: string | null }>();
    guildsCache.set('111111111111111111', {
      id: '111111111111111111',
      name: 'Alpha',
      icon: 'aaa',
    });
    guildsCache.set('222222222222222222', {
      id: '222222222222222222',
      name: 'Beta',
      icon: null,
    });
    const ctx = fakeContext({
      client: { guilds: { cache: guildsCache } } as unknown as InternalApiContext['client'],
    });
    const res = fakeRes();
    handleGuildsList(
      ctx,
      new URL('http://x/internal/guilds/list?ids=111111111111111111,333333333333333333'),
      res,
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: '111111111111111111', name: 'Alpha', iconHash: 'aaa' }]);
  });

  it('empty array on missing ids param', () => {
    const res = fakeRes();
    handleGuildsList(fakeContext(), new URL('http://x/internal/guilds/list'), res);
    expect(res.body).toEqual([]);
  });
});

describe('GET /internal/guilds/:id/resources', () => {
  it('404 when guild absent from cache', () => {
    const res = fakeRes();
    handleGuildResources(fakeContext(), '999999999999999999', res);
    expect(res.status).toBe(404);
  });

  it('returns sorted channels, categories, roles', () => {
    const everyoneId = '111111111111111111';
    const guild = {
      id: everyoneId,
      channels: {
        cache: new Map<string, unknown>([
          ['c1', { id: 'c1', name: 'general', type: ChannelType.GuildText }],
          ['c2', { id: 'c2', name: 'announcements', type: ChannelType.GuildAnnouncement }],
          ['c3', { id: 'c3', name: 'voice', type: ChannelType.GuildVoice }], // skipped
          ['cat1', { id: 'cat1', name: 'Support', type: ChannelType.GuildCategory }],
          ['cat2', { id: 'cat2', name: 'Archive', type: ChannelType.GuildCategory }],
        ]),
      },
      roles: {
        cache: new Map<string, unknown>([
          ['r1', { id: 'r1', name: 'Staff', colors: { primaryColor: 0xff0000 }, managed: false }],
          [
            'r2',
            {
              id: 'r2',
              name: 'BotInteg',
              colors: { primaryColor: 0 },
              managed: true, // skipped
            },
          ],
          [
            everyoneId,
            { id: everyoneId, name: '@everyone', colors: { primaryColor: 0 }, managed: false }, // skipped
          ],
        ]),
      },
    };
    // Make .filter() / .map() work like a Collection: just use Array.prototype
    // semantics over Map.values().
    Object.assign(guild.roles.cache, {
      filter(this: Map<string, unknown>, fn: (v: unknown) => boolean) {
        const out = [...this.values()].filter(fn);
        return { map: <T>(m: (v: unknown) => T) => out.map(m) };
      },
    });
    const ctx = fakeContext({
      client: {
        guilds: { cache: new Map([[everyoneId, guild]]) },
      } as unknown as InternalApiContext['client'],
    });
    const res = fakeRes();
    handleGuildResources(ctx, everyoneId, res);
    expect(res.status).toBe(200);
    const body = res.body as {
      channels: { id: string; name: string }[];
      categories: { id: string; name: string }[];
      roles: { id: string; name: string }[];
    };
    expect(body.channels.map((c) => c.name)).toEqual(['announcements', 'general']);
    expect(body.categories.map((c) => c.name)).toEqual(['Archive', 'Support']);
    expect(body.roles.map((r) => r.name)).toEqual(['Staff']);
  });
});

describe('POST /internal/panels/:id/render', () => {
  it('returns the renderPanel result on success', async () => {
    const renderPanel = vi.fn(async (_id: string) => ok({ messageId: 'msg-1', recreated: false }));
    const ctx = fakeContext({ panel: { renderPanel } as unknown as PanelService });
    const res = fakeRes();
    await handlePanelRender(ctx, 'p-1', res);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ messageId: 'msg-1', recreated: false });
    expect(renderPanel).toHaveBeenCalledWith('p-1');
  });

  it('404 when service returns NotFoundError', async () => {
    const ctx = fakeContext({
      panel: {
        renderPanel: async () => err(new NotFoundError('Panel not found')),
      } as unknown as PanelService,
    });
    const res = fakeRes();
    await handlePanelRender(ctx, 'p-missing', res);
    expect(res.status).toBe(404);
  });

  it('503 on DiscordApiError', async () => {
    const ctx = fakeContext({
      panel: {
        renderPanel: async () => {
          throw new DiscordApiError('Discord 500');
        },
      } as unknown as PanelService,
    });
    const res = fakeRes();
    await handlePanelRender(ctx, 'p-1', res);
    expect(res.status).toBe(503);
  });

  it('rethrows non-DiscordApiError', async () => {
    const ctx = fakeContext({
      panel: {
        renderPanel: async () => {
          throw new Error('boom');
        },
      } as unknown as PanelService,
    });
    const res = fakeRes();
    await expect(handlePanelRender(ctx, 'p-1', res)).rejects.toThrow('boom');
  });
});

describe('DELETE /internal/panels/:id', () => {
  it('200 on success', async () => {
    const ctx = fakeContext({
      panel: {
        deletePanel: async (id: string) => ok({ panelId: id }),
      } as unknown as PanelService,
    });
    const res = fakeRes();
    await handlePanelDelete(ctx, 'p-1', res);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: true, panelId: 'p-1' });
  });

  it('404 when panel missing', async () => {
    const ctx = fakeContext({
      panel: {
        deletePanel: async () => err(new NotFoundError('Panel not found')),
      } as unknown as PanelService,
    });
    const res = fakeRes();
    await handlePanelDelete(ctx, 'p-missing', res);
    expect(res.status).toBe(404);
  });

  it('503 on DiscordApiError', async () => {
    const ctx = fakeContext({
      panel: {
        deletePanel: async () => {
          throw new DiscordApiError('Discord 500');
        },
      } as unknown as PanelService,
    });
    const res = fakeRes();
    await handlePanelDelete(ctx, 'p-1', res);
    expect(res.status).toBe(503);
  });
});
