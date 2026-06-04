import { isOk } from '@hearth/shared';
import { XWatcherService } from '@hearth/x-watcher-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FakeXWatcherGateway } from '../../../../packages/x-watcher-core/tests/helpers/fakeGateway.js';
import {
  FakeXFeedSource,
  tweet,
} from '../../../../packages/x-watcher-core/tests/helpers/fakeXFeedSource.js';
import { XWatcherPoller } from '../../src/jobs/xWatcherPoller.js';
import { type IntegrationDb, startIntegrationDb } from '../helpers/testDb.js';

// End-to-end against real Postgres 16 (testcontainers) via the same
// runMigrations() the bot runs at boot — proves migration 0006 applies and
// the XWatcher tables + UNIQUE ledger behave under production-equivalent
// Postgres. The feed source + Discord gateway are faked; everything else
// (service SQL, poll algorithm, cursor, cascade) is real.

const SHOULD_RUN = process.env['RUN_INTEGRATION'] === '1';

const guildId = 'g-xw';
const channelId = 'c-xw-feed';
const HANDLE = 'KayenFinance';
const USER_ID = '424242';

const silentLogger = { info: () => undefined, warn: () => undefined, error: () => undefined };

describe.runIf(SHOULD_RUN)('integration: x-watcher lifecycle (real Postgres)', () => {
  let env: IntegrationDb;
  let service: XWatcherService;

  beforeAll(async () => {
    env = await startIntegrationDb();
    service = new XWatcherService(env.db);
  });

  afterAll(async () => {
    await env.close();
  });

  it('seeds, mirrors new posts as bare links, skips retweets, and cascades on delete', async () => {
    const created = await service.createWatcher({ guildId, sourceHandle: HANDLE, channelId });
    expect(isOk(created)).toBe(true);
    if (!isOk(created)) return;
    const watcherId = created.value.id;

    const source = new FakeXFeedSource({
      users: { [HANDLE]: USER_ID },
      items: [tweet('100'), tweet('101')],
    });
    const gateway = new FakeXWatcherGateway();
    const poller = new XWatcherPoller({
      service,
      source,
      gateway,
      logger: silentLogger,
      intervalMs: 60_000,
    });

    // First poll → seed cursor to newest (101), post nothing.
    const seed = await poller.pollOne(watcherId);
    expect(seed?.seeded).toBe(true);
    expect(gateway.sent).toHaveLength(0);

    // A new original + a retweet arrive.
    source.setItems([tweet('100'), tweet('101'), tweet('102'), tweet('103', 'retweet')]);
    const run = await poller.pollOne(watcherId);
    expect(run?.posted).toBe(1);
    expect(run?.skipped).toBe(1);
    expect(gateway.sent.map((m) => m.content)).toEqual(['https://x.com/KayenFinance/status/102']);

    // Cursor advanced past the retweet; ledger has both observations.
    const after = await service.getWatcher(watcherId);
    if (isOk(after)) expect(after.value.lastTweetId).toBe('103');
    expect(await service.countPosted(watcherId)).toBe(1);
    expect(await service.countEvents(watcherId)).toBe(2);

    // Delete cascades events (FK ON DELETE CASCADE).
    expect(isOk(await service.deleteWatcher(watcherId))).toBe(true);
    expect(await service.countEvents(watcherId)).toBe(0);
  });

  it('enforces the UNIQUE (guildId, sourceHandle, channelId) binding', async () => {
    const first = await service.createWatcher({
      guildId: 'g-dup',
      sourceHandle: 'Dupe',
      channelId: 'c-dup',
    });
    expect(isOk(first)).toBe(true);
    const second = await service.createWatcher({
      guildId: 'g-dup',
      sourceHandle: 'Dupe',
      channelId: 'c-dup',
    });
    expect(isOk(second)).toBe(false);
  });
});
