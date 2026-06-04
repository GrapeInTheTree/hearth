import { XWatcherEventStatus, type XWatcher } from '@hearth/database';
import { isOk } from '@hearth/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { pollWatcherOnce } from '../../src/lib/pollWatcher.js';
import { XWatcherService } from '../../src/xWatcherService.js';
import { FakeXWatcherGateway } from '../helpers/fakeGateway.js';
import { FakeXFeedSource, tweet } from '../helpers/fakeXFeedSource.js';
import { createTestDb, type TestDb } from '../helpers/testDb.js';

const guildId = '111111111111111111';
const channelId = '222222222222222222';
const HANDLE = 'KayenFinance';
const USER_ID = '424242';

describe('pollWatcherOnce', () => {
  let testDb: TestDb;
  let service: XWatcherService;

  beforeEach(async () => {
    testDb = await createTestDb();
    service = new XWatcherService(testDb.db);
  });

  afterEach(async () => {
    await testDb.close();
  });

  async function makeWatcher(overrides?: {
    includeQuotes?: boolean;
    includeReplies?: boolean;
    channelId?: string;
  }): Promise<XWatcher> {
    const r = await service.createWatcher({
      guildId,
      sourceHandle: HANDLE,
      channelId: overrides?.channelId ?? channelId,
      ...(overrides?.includeQuotes !== undefined ? { includeQuotes: overrides.includeQuotes } : {}),
      ...(overrides?.includeReplies !== undefined
        ? { includeReplies: overrides.includeReplies }
        : {}),
    });
    if (!isOk(r)) throw new Error('create failed');
    return r.value;
  }

  async function fresh(id: string): Promise<XWatcher> {
    const r = await service.getWatcher(id);
    if (!isOk(r)) throw new Error('watcher gone');
    return r.value;
  }

  function ledgerStatuses(events: { status: string; tweetId: string }[]): Record<string, string> {
    return Object.fromEntries(events.map((e) => [e.tweetId, e.status]));
  }

  it('first poll seeds the cursor to the newest id and posts nothing', async () => {
    const watcher = await makeWatcher();
    const source = new FakeXFeedSource({
      users: { [HANDLE]: USER_ID },
      items: [tweet('100'), tweet('101'), tweet('102')],
    });
    const gateway = new FakeXWatcherGateway();

    const summary = await pollWatcherOnce({ watcher, source, gateway, service });

    expect(summary.seeded).toBe(true);
    expect(summary.posted).toBe(0);
    expect(summary.newCursor).toBe('102');
    expect(gateway.sent).toHaveLength(0);
    expect(await service.countEvents(watcher.id)).toBe(0);
    expect((await fresh(watcher.id)).lastTweetId).toBe('102');
  });

  it('persists the resolved user id and resolves it only once across polls', async () => {
    const watcher = await makeWatcher();
    const source = new FakeXFeedSource({ users: { [HANDLE]: USER_ID }, items: [tweet('100')] });
    const gateway = new FakeXWatcherGateway();

    await pollWatcherOnce({ watcher, source, gateway, service });
    expect((await fresh(watcher.id)).sourceUserId).toBe(USER_ID);

    await pollWatcherOnce({ watcher: await fresh(watcher.id), source, gateway, service });
    expect(source.resolveCalls).toBe(1);
  });

  it('mirrors new originals as bare links, oldest-first, advancing the cursor', async () => {
    const watcher = await makeWatcher();
    const source = new FakeXFeedSource({ users: { [HANDLE]: USER_ID }, items: [tweet('100')] });
    const gateway = new FakeXWatcherGateway();

    // Seed.
    await pollWatcherOnce({ watcher, source, gateway, service });

    // Two new posts arrive (added out of order to prove sorting).
    source.setItems([tweet('100'), tweet('103'), tweet('102')]);
    const summary = await pollWatcherOnce({
      watcher: await fresh(watcher.id),
      source,
      gateway,
      service,
    });

    expect(summary.posted).toBe(2);
    expect(gateway.sent.map((m) => m.content)).toEqual([
      'https://x.com/KayenFinance/status/102',
      'https://x.com/KayenFinance/status/103',
    ]);
    expect(gateway.sent.every((m) => m.channelId === channelId)).toBe(true);
    expect((await fresh(watcher.id)).lastTweetId).toBe('103');

    const events = await service.listEvents(watcher.id);
    expect(ledgerStatuses(events)).toEqual({
      '102': XWatcherEventStatus.posted,
      '103': XWatcherEventStatus.posted,
    });
  });

  it('skips retweets (ledger only, no post)', async () => {
    const watcher = await makeWatcher();
    const source = new FakeXFeedSource({ users: { [HANDLE]: USER_ID }, items: [tweet('100')] });
    const gateway = new FakeXWatcherGateway();
    await pollWatcherOnce({ watcher, source, gateway, service });

    source.setItems([tweet('100'), tweet('101', 'retweet')]);
    const summary = await pollWatcherOnce({
      watcher: await fresh(watcher.id),
      source,
      gateway,
      service,
    });

    expect(summary.posted).toBe(0);
    expect(summary.skipped).toBe(1);
    expect(gateway.sent).toHaveLength(0);
    const events = await service.listEvents(watcher.id);
    expect(ledgerStatuses(events)['101']).toBe(XWatcherEventStatus.skippedRetweet);
    expect((await fresh(watcher.id)).lastTweetId).toBe('101');
  });

  it('includes quotes by default, skips them when includeQuotes is false', async () => {
    // default watcher → quote posted
    const w1 = await makeWatcher();
    const s1 = new FakeXFeedSource({ users: { [HANDLE]: USER_ID }, items: [tweet('100')] });
    const g1 = new FakeXWatcherGateway();
    await pollWatcherOnce({ watcher: w1, source: s1, gateway: g1, service });
    s1.setItems([tweet('100'), tweet('101', 'quote')]);
    await pollWatcherOnce({ watcher: await fresh(w1.id), source: s1, gateway: g1, service });
    expect(g1.sent).toHaveLength(1);

    // includeQuotes:false → quote skipped (different channel to avoid the
    // unique (guild, handle, channel) collision with w1).
    const w2 = await makeWatcher({ includeQuotes: false, channelId: '333333333333333333' });
    const s2 = new FakeXFeedSource({ users: { [HANDLE]: USER_ID }, items: [tweet('200')] });
    const g2 = new FakeXWatcherGateway();
    await pollWatcherOnce({ watcher: w2, source: s2, gateway: g2, service });
    s2.setItems([tweet('200'), tweet('201', 'quote')]);
    const summary = await pollWatcherOnce({
      watcher: await fresh(w2.id),
      source: s2,
      gateway: g2,
      service,
    });
    expect(g2.sent).toHaveLength(0);
    expect(ledgerStatuses(await service.listEvents(w2.id))['201']).toBe(
      XWatcherEventStatus.skippedQuote,
    );
    expect(summary.skipped).toBe(1);
  });

  it('skips replies by default, posts them when includeReplies is true', async () => {
    const w = await makeWatcher({ includeReplies: true });
    const source = new FakeXFeedSource({ users: { [HANDLE]: USER_ID }, items: [tweet('100')] });
    const gateway = new FakeXWatcherGateway();
    await pollWatcherOnce({ watcher: w, source, gateway, service });

    source.setItems([tweet('100'), tweet('101', 'reply')]);
    await pollWatcherOnce({ watcher: await fresh(w.id), source, gateway, service });
    expect(gateway.sent).toHaveLength(1);
    expect(ledgerStatuses(await service.listEvents(w.id))['101']).toBe(XWatcherEventStatus.posted);
  });

  it('records send_failed and advances the cursor when Discord rejects the send', async () => {
    const watcher = await makeWatcher();
    const source = new FakeXFeedSource({ users: { [HANDLE]: USER_ID }, items: [tweet('100')] });
    const okGateway = new FakeXWatcherGateway();
    await pollWatcherOnce({ watcher, source, gateway: okGateway, service });

    source.setItems([tweet('100'), tweet('101')]);
    const failGateway = new FakeXWatcherGateway({ failSend: true });
    const summary = await pollWatcherOnce({
      watcher: await fresh(watcher.id),
      source,
      gateway: failGateway,
      service,
    });

    expect(summary.failed).toBe(1);
    expect(summary.posted).toBe(0);
    // Cursor advanced so the bad post isn't retried forever.
    expect((await fresh(watcher.id)).lastTweetId).toBe('101');
    expect(ledgerStatuses(await service.listEvents(watcher.id))['101']).toBe(
      XWatcherEventStatus.sendFailed,
    );
  });

  it('reports unresolved and posts nothing when the handle does not resolve', async () => {
    const watcher = await makeWatcher();
    const source = new FakeXFeedSource({ users: {}, items: [tweet('100')] }); // no mapping
    const gateway = new FakeXWatcherGateway();

    const summary = await pollWatcherOnce({ watcher, source, gateway, service });

    expect(summary.unresolved).toBe(true);
    expect(summary.posted).toBe(0);
    expect(gateway.sent).toHaveLength(0);
    expect(source.fetchCalls).toBe(0);
    const after = await fresh(watcher.id);
    expect(after.lastTweetId).toBeNull();
    expect(after.lastCheckedAt).not.toBeNull();
  });

  it('is idempotent — re-polling with no new posts mirrors nothing', async () => {
    const watcher = await makeWatcher();
    const source = new FakeXFeedSource({ users: { [HANDLE]: USER_ID }, items: [tweet('100')] });
    const gateway = new FakeXWatcherGateway();
    await pollWatcherOnce({ watcher, source, gateway, service });

    source.setItems([tweet('100'), tweet('101')]);
    await pollWatcherOnce({ watcher: await fresh(watcher.id), source, gateway, service });
    expect(gateway.sent).toHaveLength(1);

    // Nothing new arrives — a second poll posts nothing more.
    const summary = await pollWatcherOnce({
      watcher: await fresh(watcher.id),
      source,
      gateway,
      service,
    });
    expect(summary.posted).toBe(0);
    expect(gateway.sent).toHaveLength(1);
  });
});
