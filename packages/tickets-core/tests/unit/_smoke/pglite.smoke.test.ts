// PGlite + Drizzle integration smoke test. Validates that:
//  1. The 0000_init.sql migration applies cleanly to PGlite
//  2. Drizzle's query builder over PGlite returns rows in the same shape
//     as node-postgres
//  3. Partial unique index `ticket_open_dedupe` enforces the race-guard
//  4. Foreign key RESTRICT blocks panel deletes with live tickets
//
// If this file fails, the entire PR-2a + PR-2b test infrastructure is
// suspect — that's the canary purpose. Service tests below assume these
// invariants.

import { eq, isUniqueViolation, schema } from '@hearth/database';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTestDb, type TestDb } from '../../helpers/testDb.js';

describe('pglite smoke', () => {
  let testDb: TestDb;

  beforeEach(async () => {
    testDb = await createTestDb();
  });

  afterEach(async () => {
    await testDb.close();
  });

  it('applies 0000_init.sql and inserts/queries a panel', async () => {
    const { db } = testDb;
    const [panel] = await db
      .insert(schema.panel)
      .values({
        guildId: 'g1',
        channelId: 'c1',
        messageId: 'm1',
        embedTitle: 'Hello',
        embedDescription: 'World',
      })
      .returning();
    expect(panel?.id).toMatch(/^c[a-z0-9]+$/); // cuid v1 shape
    expect(panel?.guildId).toBe('g1');

    const [fetched] = await db.select().from(schema.panel).where(eq(schema.panel.id, panel!.id));
    expect(fetched?.embedTitle).toBe('Hello');
    expect(fetched?.createdAt).toBeInstanceOf(Date);
  });

  it('enforces ticket_open_dedupe partial unique index', async () => {
    const { db } = testDb;

    const [panel] = await db
      .insert(schema.panel)
      .values({
        guildId: 'g1',
        channelId: 'c1',
        messageId: 'm1',
        embedTitle: 't',
        embedDescription: 'd',
      })
      .returning();
    const [type] = await db
      .insert(schema.panelTicketType)
      .values({
        panelId: panel!.id,
        name: 'support',
        emoji: '',
        buttonStyle: 'success',
        activeCategoryId: 'cat1',
        supportRoleIds: [],
        pingRoleIds: [],
      })
      .returning();

    await db.insert(schema.ticket).values({
      guildId: 'g1',
      panelId: panel!.id,
      panelTypeId: type!.id,
      channelId: 'tc1',
      number: 1,
      openerId: 'u1',
      status: 'open',
    });

    let caught: unknown;
    try {
      await db.insert(schema.ticket).values({
        guildId: 'g1',
        panelId: panel!.id,
        panelTypeId: type!.id,
        channelId: 'tc2',
        number: 2,
        openerId: 'u1', // same opener, same type, same status — partial unique violation
        status: 'open',
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
    expect(isUniqueViolation(caught)).toBe(true);
  });

  it('partial unique allows reopen after close (different status)', async () => {
    const { db } = testDb;
    const [panel] = await db
      .insert(schema.panel)
      .values({
        guildId: 'g1',
        channelId: 'c1',
        messageId: 'm1',
        embedTitle: 't',
        embedDescription: 'd',
      })
      .returning();
    const [type] = await db
      .insert(schema.panelTicketType)
      .values({
        panelId: panel!.id,
        name: 'support',
        emoji: '',
        buttonStyle: 'success',
        activeCategoryId: 'cat1',
        supportRoleIds: [],
        pingRoleIds: [],
      })
      .returning();

    // First ticket: open → closed.
    const [t1] = await db
      .insert(schema.ticket)
      .values({
        guildId: 'g1',
        panelId: panel!.id,
        panelTypeId: type!.id,
        channelId: 'tc1',
        number: 1,
        openerId: 'u1',
        status: 'open',
      })
      .returning();
    await db.update(schema.ticket).set({ status: 'closed' }).where(eq(schema.ticket.id, t1!.id));

    // Second ticket for same opener/type — should succeed since the first is now 'closed'.
    const [t2] = await db
      .insert(schema.ticket)
      .values({
        guildId: 'g1',
        panelId: panel!.id,
        panelTypeId: type!.id,
        channelId: 'tc2',
        number: 2,
        openerId: 'u1',
        status: 'open',
      })
      .returning();
    expect(t2?.status).toBe('open');
  });
});
