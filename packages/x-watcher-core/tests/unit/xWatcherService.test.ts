import { XWatcherEventStatus } from '@hearth/database';
import { isErr, isOk } from '@hearth/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { XWatcherService } from '../../src/xWatcherService.js';
import { createTestDb, type TestDb } from '../helpers/testDb.js';

const guildId = '111111111111111111';
const channelId = '222222222222222222';
const otherChannel = '333333333333333333';

describe('XWatcherService', () => {
  let testDb: TestDb;
  let service: XWatcherService;

  beforeEach(async () => {
    testDb = await createTestDb();
    service = new XWatcherService(testDb.db);
  });

  afterEach(async () => {
    await testDb.close();
  });

  async function create(handle = 'KayenFinance', channel = channelId) {
    const r = await service.createWatcher({ guildId, sourceHandle: handle, channelId: channel });
    if (!isOk(r)) throw new Error('create failed');
    return r.value;
  }

  describe('createWatcher', () => {
    it('creates with column defaults (enabled, quotes on, replies off, cursor null)', async () => {
      const w = await create();
      expect(w.sourceHandle).toBe('KayenFinance');
      expect(w.enabled).toBe(true);
      expect(w.includeQuotes).toBe(true);
      expect(w.includeReplies).toBe(false);
      expect(w.lastTweetId).toBeNull();
      expect(w.sourceUserId).toBeNull();
    });

    it('honours explicit toggles', async () => {
      const r = await service.createWatcher({
        guildId,
        sourceHandle: 'Acme',
        channelId,
        includeQuotes: false,
        includeReplies: true,
        enabled: false,
      });
      expect(isOk(r)).toBe(true);
      if (isOk(r)) {
        expect(r.value.includeQuotes).toBe(false);
        expect(r.value.includeReplies).toBe(true);
        expect(r.value.enabled).toBe(false);
      }
    });

    it('rejects a duplicate (guildId, sourceHandle, channelId) with ConflictError', async () => {
      await create();
      const dup = await service.createWatcher({ guildId, sourceHandle: 'KayenFinance', channelId });
      expect(isErr(dup)).toBe(true);
    });

    it('allows the same handle in a different channel', async () => {
      await create();
      const second = await service.createWatcher({
        guildId,
        sourceHandle: 'KayenFinance',
        channelId: otherChannel,
      });
      expect(isOk(second)).toBe(true);
    });
  });

  describe('editWatcher', () => {
    it('updates channel + toggles, leaving the handle untouched', async () => {
      const w = await create();
      const r = await service.editWatcher(w.id, {
        channelId: otherChannel,
        includeReplies: true,
      });
      expect(isOk(r)).toBe(true);
      if (isOk(r)) {
        expect(r.value.channelId).toBe(otherChannel);
        expect(r.value.includeReplies).toBe(true);
        expect(r.value.sourceHandle).toBe('KayenFinance');
      }
    });

    it('is a no-op that returns the row when no fields change', async () => {
      const w = await create();
      const r = await service.editWatcher(w.id, {});
      expect(isOk(r)).toBe(true);
      if (isOk(r)) expect(r.value.id).toBe(w.id);
    });

    it('returns NotFoundError for a missing id', async () => {
      const r = await service.editWatcher('nope', { enabled: false });
      expect(isErr(r)).toBe(true);
    });
  });

  describe('setEnabled', () => {
    it('toggles enabled', async () => {
      const w = await create();
      const off = await service.setEnabled(w.id, false);
      expect(isOk(off)).toBe(true);
      if (isOk(off)) expect(off.value.enabled).toBe(false);
    });
  });

  describe('list / get / delete', () => {
    it('lists a guild watchers newest-first', async () => {
      const a = await create('AccountA');
      const b = await create('AccountB');
      const list = await service.listWatchers(guildId);
      expect(list.map((w) => w.id)).toEqual([b.id, a.id]);
    });

    it('getWatcher returns the row or NotFoundError', async () => {
      const w = await create();
      expect(isOk(await service.getWatcher(w.id))).toBe(true);
      expect(isErr(await service.getWatcher('nope'))).toBe(true);
    });

    it('deleteWatcher removes the row', async () => {
      const w = await create();
      expect(isOk(await service.deleteWatcher(w.id))).toBe(true);
      expect(isErr(await service.getWatcher(w.id))).toBe(true);
    });

    it('deleteWatcher returns NotFoundError for a missing id', async () => {
      expect(isErr(await service.deleteWatcher('nope'))).toBe(true);
    });
  });

  describe('getEnabledWatchers', () => {
    it('returns only enabled rows', async () => {
      const a = await create('AccountA');
      const b = await create('AccountB');
      await service.setEnabled(b.id, false);
      const enabled = await service.getEnabledWatchers();
      expect(enabled.map((w) => w.id)).toEqual([a.id]);
    });
  });

  describe('poller support', () => {
    it('setSourceUserId / markPolled / markChecked persist', async () => {
      const w = await create();
      await service.setSourceUserId(w.id, '424242');
      await service.markPolled(w.id, '1797000000000000005');
      const after = await service.getWatcher(w.id);
      if (isOk(after)) {
        expect(after.value.sourceUserId).toBe('424242');
        expect(after.value.lastTweetId).toBe('1797000000000000005');
        expect(after.value.lastCheckedAt).not.toBeNull();
      }
    });
  });

  describe('recordEvent + audit reads', () => {
    it('records events and counts posted vs total', async () => {
      const w = await create();
      await service.recordEvent({
        watcherId: w.id,
        tweetId: '1',
        tweetUrl: 'https://x.com/KayenFinance/status/1',
        kind: 'original',
        status: XWatcherEventStatus.posted,
        postedMessageId: 'm1',
      });
      await service.recordEvent({
        watcherId: w.id,
        tweetId: '2',
        tweetUrl: 'https://x.com/KayenFinance/status/2',
        kind: 'retweet',
        status: XWatcherEventStatus.skippedRetweet,
        postedMessageId: null,
      });
      expect(await service.countEvents(w.id)).toBe(2);
      expect(await service.countPosted(w.id)).toBe(1);
      expect((await service.listEvents(w.id)).length).toBe(2);
    });

    it('is idempotent on (watcherId, tweetId) — duplicate is swallowed', async () => {
      const w = await create();
      const ev = {
        watcherId: w.id,
        tweetId: '1',
        tweetUrl: 'https://x.com/KayenFinance/status/1',
        kind: 'original',
        status: XWatcherEventStatus.posted,
        postedMessageId: 'm1',
      };
      await service.recordEvent(ev);
      await service.recordEvent(ev); // must not throw, must not duplicate
      expect(await service.countEvents(w.id)).toBe(1);
    });
  });
});
