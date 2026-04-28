import { ValidationError } from '@hearth/shared';
import { beforeEach, describe, expect, it } from 'vitest';

import { GuildConfigService } from '../../../src/guildConfigService.js';
import { createFakeDb, type FakeDb } from '../../helpers/fakeDb.js';

describe('GuildConfigService', () => {
  let db: FakeDb;
  let service: GuildConfigService;

  beforeEach(() => {
    db = createFakeDb();
    service = new GuildConfigService(db);
  });

  it('getOrCreate returns existing row idempotently', async () => {
    const a = await service.getOrCreate('g1');
    const b = await service.getOrCreate('g1');
    expect(a.guildId).toBe('g1');
    expect(b.guildId).toBe('g1');
    expect(db.tables.guildConfig.size).toBe(1);
  });

  it('setArchiveCategory rejects invalid snowflake', async () => {
    const result = await service.setArchiveCategory('g1', 'not-a-snowflake');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(ValidationError);
    }
  });

  it('setArchiveCategory upserts on valid input', async () => {
    const result = await service.setArchiveCategory('g1', '111111111111111111');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.archiveCategoryId).toBe('111111111111111111');
  });

  it('setLogChannel rejects invalid snowflake', async () => {
    const result = await service.setLogChannel('g1', 'bad');
    expect(result.ok).toBe(false);
  });

  it('setLogChannel persists alertChannelId', async () => {
    const result = await service.setLogChannel('g1', '222222222222222222');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.alertChannelId).toBe('222222222222222222');
  });

  it('incrementTicketCounter increments atomically', async () => {
    // Direct call (no $transaction wrapper needed for fake)
    const tx = db as unknown as Parameters<typeof service.incrementTicketCounter>[0];
    expect(await service.incrementTicketCounter(tx, 'g1')).toBe(1);
    expect(await service.incrementTicketCounter(tx, 'g1')).toBe(2);
    expect(await service.incrementTicketCounter(tx, 'g1')).toBe(3);
  });

  it('incrementTicketCounter is per-guild', async () => {
    const tx = db as unknown as Parameters<typeof service.incrementTicketCounter>[0];
    expect(await service.incrementTicketCounter(tx, 'g1')).toBe(1);
    expect(await service.incrementTicketCounter(tx, 'g2')).toBe(1);
    expect(await service.incrementTicketCounter(tx, 'g1')).toBe(2);
  });
});
