import { count, eq, schema, VerificationOutcome } from '@hearth/database';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  type VerificationOptionInput,
  type VerificationPanelInput,
  VerificationService,
} from '../../src/verificationService.js';
import { FakeDiscordGateway } from '../helpers/fakeGateway.js';
import { branding } from '../helpers/testBranding.js';
import { createTestDb, type TestDb } from '../helpers/testDb.js';

const GUILD_ID = '111111111111111111';
const CHANNEL_ID = '222222222222222222';
const ROLE_ID = '333333333333333333';
const USER_ID = '444444444444444444';

const basePanel: VerificationPanelInput = {
  guildId: GUILD_ID,
  channelId: CHANNEL_ID,
  embedTitle: 'Verify',
  embedDescription: 'Click the right one.',
  roleId: ROLE_ID,
};

function optionInput(overrides: Partial<VerificationOptionInput> = {}): VerificationOptionInput {
  return {
    label: '🍎 Apple',
    emoji: '🍎',
    buttonStyle: 'primary',
    position: 0,
    ...overrides,
  };
}

async function countRows(
  testDb: TestDb,
  table:
    | typeof schema.verificationPanel
    | typeof schema.verificationOption
    | typeof schema.verificationEvent,
): Promise<number> {
  const [row] = await testDb.db.select({ value: count() }).from(table);
  return row?.value ?? 0;
}

describe('VerificationService.createPanel', () => {
  let testDb: TestDb;
  let gateway: FakeDiscordGateway;
  let service: VerificationService;

  beforeEach(async () => {
    testDb = await createTestDb();
    gateway = new FakeDiscordGateway();
    service = new VerificationService(testDb.db, gateway, branding);
  });
  afterEach(async () => {
    await testDb.close();
  });

  it('inserts a panel row with placeholder messageId and no options', async () => {
    const result = await service.createPanel(basePanel);
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.value.created).toBe(true);
    expect(result.value.panel.guildId).toBe(GUILD_ID);
    expect(result.value.panel.messageId).toBe('pending');
    expect(result.value.panel.correctOptionId).toBeNull();
    expect(await countRows(testDb, schema.verificationPanel)).toBe(1);
    expect(await countRows(testDb, schema.verificationOption)).toBe(0);
    // Discord side-effect must not run on create — render is explicit.
    expect(gateway.calls).toEqual([]);
  });

  it('falls back to default copy when title/description are omitted', async () => {
    const result = await service.createPanel({
      guildId: GUILD_ID,
      channelId: CHANNEL_ID,
      roleId: ROLE_ID,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.value.panel.embedTitle).toMatch(/Verification/i);
    expect(result.value.panel.embedDescription.length).toBeGreaterThan(0);
  });

  it('rejects a second placeholder panel on the same channel', async () => {
    await service.createPanel(basePanel);
    const second = await service.createPanel(basePanel);
    expect(second.ok).toBe(false);
    if (second.ok) throw new Error('expected ConflictError');
    expect(second.error.code).toBe('CONFLICT');
  });
});

describe('VerificationService.editPanel', () => {
  let testDb: TestDb;
  let gateway: FakeDiscordGateway;
  let service: VerificationService;
  let panelId: string;

  beforeEach(async () => {
    testDb = await createTestDb();
    gateway = new FakeDiscordGateway();
    service = new VerificationService(testDb.db, gateway, branding);
    const create = await service.createPanel(basePanel);
    if (!create.ok) throw create.error;
    panelId = create.value.panel.id;
  });
  afterEach(async () => {
    await testDb.close();
  });

  it('updates only the fields the form provided', async () => {
    const updated = await service.editPanel(panelId, { embedTitle: 'New title' });
    expect(updated.ok).toBe(true);
    if (!updated.ok) throw updated.error;
    expect(updated.value.embedTitle).toBe('New title');
    expect(updated.value.embedDescription).toBe(basePanel.embedDescription);
  });

  it('returns NotFoundError when panelId is unknown', async () => {
    const updated = await service.editPanel('does-not-exist', { roleId: ROLE_ID });
    expect(updated.ok).toBe(false);
    if (updated.ok) throw new Error('expected NotFound');
    expect(updated.error.code).toBe('NOT_FOUND');
  });

  it('returns the existing row unchanged when no fields are provided', async () => {
    const before = await service.getPanel(panelId);
    if (!before.ok) throw before.error;
    const result = await service.editPanel(panelId, {});
    if (!result.ok) throw result.error;
    expect(result.value.embedTitle).toBe(before.value.embedTitle);
  });
});

describe('VerificationService.listPanels / getPanel', () => {
  let testDb: TestDb;
  let service: VerificationService;

  beforeEach(async () => {
    testDb = await createTestDb();
    service = new VerificationService(testDb.db, new FakeDiscordGateway(), branding);
  });
  afterEach(async () => {
    await testDb.close();
  });

  it('returns panels filtered by guild with their options sorted by position', async () => {
    const a = await service.createPanel(basePanel);
    if (!a.ok) throw a.error;
    await service.addOption(a.value.panel.id, optionInput({ position: 2, label: 'C' }));
    await service.addOption(a.value.panel.id, optionInput({ position: 0, label: 'A' }));
    await service.addOption(a.value.panel.id, optionInput({ position: 1, label: 'B' }));
    const panels = await service.listPanels(GUILD_ID);
    expect(panels).toHaveLength(1);
    expect(panels[0]?.options.map((o) => o.label)).toEqual(['A', 'B', 'C']);
  });

  it('getPanel returns NotFoundError on unknown id', async () => {
    const result = await service.getPanel('missing');
    expect(result.ok).toBe(false);
  });
});

describe('VerificationService.addOption', () => {
  let testDb: TestDb;
  let service: VerificationService;
  let panelId: string;

  beforeEach(async () => {
    testDb = await createTestDb();
    service = new VerificationService(testDb.db, new FakeDiscordGateway(), branding);
    const create = await service.createPanel(basePanel);
    if (!create.ok) throw create.error;
    panelId = create.value.panel.id;
  });
  afterEach(async () => {
    await testDb.close();
  });

  it('inserts an option with the given fields', async () => {
    const result = await service.addOption(panelId, optionInput());
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.value.label).toBe('🍎 Apple');
    expect(result.value.position).toBe(0);
  });

  it('rejects duplicate label on the same panel', async () => {
    await service.addOption(panelId, optionInput({ label: 'A', position: 0 }));
    const dup = await service.addOption(panelId, optionInput({ label: 'A', position: 1 }));
    expect(dup.ok).toBe(false);
    if (dup.ok) throw new Error('expected conflict');
    expect(dup.error.code).toBe('CONFLICT');
  });

  it('rejects duplicate position on the same panel', async () => {
    await service.addOption(panelId, optionInput({ label: 'A', position: 0 }));
    const dup = await service.addOption(panelId, optionInput({ label: 'B', position: 0 }));
    expect(dup.ok).toBe(false);
    if (dup.ok) throw new Error('expected conflict');
    expect(dup.error.code).toBe('CONFLICT');
  });

  it('rejects a 6th option (Discord 5-button limit)', async () => {
    for (let i = 0; i < 5; i++) {
      const res = await service.addOption(
        panelId,
        optionInput({ label: `Opt${String(i)}`, position: i }),
      );
      if (!res.ok) throw res.error;
    }
    // 6th would also fail position validation, but the limit-reached
    // check fires first because we're asking for "any new option".
    const sixth = await service.addOption(panelId, optionInput({ label: 'Opt5', position: 0 }));
    expect(sixth.ok).toBe(false);
    if (sixth.ok) throw new Error('expected limit error');
    expect(sixth.error.code).toBe('CONFLICT');
  });

  it('rejects out-of-range position', async () => {
    const result = await service.addOption(panelId, optionInput({ position: 5 }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected validation');
    expect(result.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns NotFoundError when panelId is unknown', async () => {
    const result = await service.addOption('missing', optionInput());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected not found');
    expect(result.error.code).toBe('NOT_FOUND');
  });
});

describe('VerificationService.editOption', () => {
  let testDb: TestDb;
  let service: VerificationService;
  let panelId: string;
  let optionAId: string;
  let optionBId: string;

  beforeEach(async () => {
    testDb = await createTestDb();
    service = new VerificationService(testDb.db, new FakeDiscordGateway(), branding);
    const create = await service.createPanel(basePanel);
    if (!create.ok) throw create.error;
    panelId = create.value.panel.id;
    const a = await service.addOption(panelId, optionInput({ label: 'A', position: 0 }));
    const b = await service.addOption(panelId, optionInput({ label: 'B', position: 1 }));
    if (!a.ok || !b.ok) throw new Error('seed');
    optionAId = a.value.id;
    optionBId = b.value.id;
  });
  afterEach(async () => {
    await testDb.close();
  });

  it('updates label and emoji in place', async () => {
    const result = await service.editOption(optionAId, { label: 'Apple', emoji: '🍏' });
    if (!result.ok) throw result.error;
    expect(result.value.label).toBe('Apple');
    expect(result.value.emoji).toBe('🍏');
  });

  it('rejects label collision with another option on the same panel', async () => {
    const result = await service.editOption(optionAId, { label: 'B' });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected conflict');
    expect(result.error.code).toBe('CONFLICT');
  });

  it('rejects position collision with another option on the same panel', async () => {
    const result = await service.editOption(optionAId, { position: 1 });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected conflict');
    expect(result.error.code).toBe('CONFLICT');
  });

  it('returns the existing row when no fields are provided', async () => {
    const result = await service.editOption(optionBId, {});
    if (!result.ok) throw result.error;
    expect(result.value.label).toBe('B');
  });

  it('returns NotFoundError on unknown optionId', async () => {
    const result = await service.editOption('missing', { label: 'x' });
    expect(result.ok).toBe(false);
  });
});

describe('VerificationService.removeOption', () => {
  let testDb: TestDb;
  let service: VerificationService;
  let panelId: string;
  let optionAId: string;
  let optionBId: string;

  beforeEach(async () => {
    testDb = await createTestDb();
    service = new VerificationService(testDb.db, new FakeDiscordGateway(), branding);
    const create = await service.createPanel(basePanel);
    if (!create.ok) throw create.error;
    panelId = create.value.panel.id;
    const a = await service.addOption(panelId, optionInput({ label: 'A', position: 0 }));
    const b = await service.addOption(panelId, optionInput({ label: 'B', position: 1 }));
    if (!a.ok || !b.ok) throw new Error('seed');
    optionAId = a.value.id;
    optionBId = b.value.id;
  });
  afterEach(async () => {
    await testDb.close();
  });

  it('deletes a non-correct option', async () => {
    const result = await service.removeOption(optionBId);
    if (!result.ok) throw result.error;
    expect(result.value.removedId).toBe(optionBId);
    expect(await countRows(testDb, schema.verificationOption)).toBe(1);
  });

  it("rejects removal of the panel's correct option", async () => {
    const setCorrect = await service.setCorrectOption(panelId, optionAId);
    if (!setCorrect.ok) throw setCorrect.error;
    const result = await service.removeOption(optionAId);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected conflict');
    expect(result.error.code).toBe('CONFLICT');
  });

  it('returns NotFoundError on unknown optionId', async () => {
    const result = await service.removeOption('missing');
    expect(result.ok).toBe(false);
  });
});

describe('VerificationService.setCorrectOption', () => {
  let testDb: TestDb;
  let service: VerificationService;

  beforeEach(async () => {
    testDb = await createTestDb();
    service = new VerificationService(testDb.db, new FakeDiscordGateway(), branding);
  });
  afterEach(async () => {
    await testDb.close();
  });

  it('marks the chosen option as correct', async () => {
    const create = await service.createPanel(basePanel);
    if (!create.ok) throw create.error;
    const opt = await service.addOption(create.value.panel.id, optionInput());
    if (!opt.ok) throw opt.error;
    const result = await service.setCorrectOption(create.value.panel.id, opt.value.id);
    if (!result.ok) throw result.error;
    expect(result.value.correctOptionId).toBe(opt.value.id);
  });

  it('rejects when option belongs to a different panel', async () => {
    const a = await service.createPanel(basePanel);
    if (!a.ok) throw a.error;
    const optA = await service.addOption(a.value.panel.id, optionInput());
    if (!optA.ok) throw optA.error;
    // Publish A first so the placeholder is freed for B.
    await testDb.db
      .update(schema.verificationPanel)
      .set({ messageId: 'm-a' })
      .where(eq(schema.verificationPanel.id, a.value.panel.id));
    const b = await service.createPanel(basePanel);
    if (!b.ok) throw b.error;
    const result = await service.setCorrectOption(b.value.panel.id, optA.value.id);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected validation');
    expect(result.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns NotFoundError on unknown optionId', async () => {
    const create = await service.createPanel(basePanel);
    if (!create.ok) throw create.error;
    const result = await service.setCorrectOption(create.value.panel.id, 'missing');
    expect(result.ok).toBe(false);
  });
});

describe('VerificationService.renderPanel + repostPanel', () => {
  let testDb: TestDb;
  let gateway: FakeDiscordGateway;
  let service: VerificationService;
  let panelId: string;
  let optionAId: string;

  beforeEach(async () => {
    testDb = await createTestDb();
    gateway = new FakeDiscordGateway();
    service = new VerificationService(testDb.db, gateway, branding);
    const create = await service.createPanel(basePanel);
    if (!create.ok) throw create.error;
    panelId = create.value.panel.id;
    const a = await service.addOption(panelId, optionInput({ label: 'A', position: 0 }));
    if (!a.ok) throw a.error;
    optionAId = a.value.id;
  });
  afterEach(async () => {
    await testDb.close();
  });

  it('renderPanel fails with ConflictError when correctOptionId is null and options exist', async () => {
    const result = await service.renderPanel(panelId);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected conflict');
    expect(result.error.code).toBe('CONFLICT');
  });

  it('renderPanel sends fresh message on first publish (placeholder → real id)', async () => {
    await service.setCorrectOption(panelId, optionAId);
    const result = await service.renderPanel(panelId);
    if (!result.ok) throw result.error;
    expect(result.value.recreated).toBe(true);
    expect(gateway.callsOf('sendVerificationMessage')).toHaveLength(1);
    const refreshed = await service.getPanel(panelId);
    if (!refreshed.ok) throw refreshed.error;
    expect(refreshed.value.messageId).not.toBe('pending');
  });

  it('renderPanel edits an existing message in place after publish', async () => {
    await service.setCorrectOption(panelId, optionAId);
    await service.renderPanel(panelId);
    gateway.reset();
    const second = await service.renderPanel(panelId);
    if (!second.ok) throw second.error;
    expect(second.value.recreated).toBe(false);
    expect(gateway.callsOf('editVerificationMessage')).toHaveLength(1);
    expect(gateway.callsOf('sendVerificationMessage')).toHaveLength(0);
  });

  it('renderPanel falls back to send when editVerificationMessage throws (live message gone)', async () => {
    await service.setCorrectOption(panelId, optionAId);
    await service.renderPanel(panelId);
    gateway = new FakeDiscordGateway({ throwOn: new Set(['editVerificationMessage']) });
    service = new VerificationService(testDb.db, gateway, branding);
    const result = await service.renderPanel(panelId);
    if (!result.ok) throw result.error;
    expect(result.value.recreated).toBe(true);
    expect(gateway.callsOf('sendVerificationMessage')).toHaveLength(1);
  });

  it('repostPanel deletes previous message and sends a new one', async () => {
    await service.setCorrectOption(panelId, optionAId);
    const first = await service.renderPanel(panelId);
    if (!first.ok) throw first.error;
    gateway.reset();
    const repost = await service.repostPanel(panelId);
    if (!repost.ok) throw repost.error;
    expect(repost.value.previousMessageId).toBe(first.value.messageId);
    expect(repost.value.messageId).not.toBe(first.value.messageId);
    expect(gateway.callsOf('deleteVerificationMessage')).toHaveLength(1);
    expect(gateway.callsOf('sendVerificationMessage')).toHaveLength(1);
  });

  it('repostPanel skips delete when the panel has only ever held a placeholder', async () => {
    await service.setCorrectOption(panelId, optionAId);
    const result = await service.repostPanel(panelId);
    if (!result.ok) throw result.error;
    expect(gateway.callsOf('deleteVerificationMessage')).toHaveLength(0);
    expect(gateway.callsOf('sendVerificationMessage')).toHaveLength(1);
  });
});

describe('VerificationService.deletePanel', () => {
  let testDb: TestDb;
  let gateway: FakeDiscordGateway;
  let service: VerificationService;

  beforeEach(async () => {
    testDb = await createTestDb();
    gateway = new FakeDiscordGateway();
    service = new VerificationService(testDb.db, gateway, branding);
  });
  afterEach(async () => {
    await testDb.close();
  });

  it('removes the row and cascades options + events', async () => {
    const create = await service.createPanel(basePanel);
    if (!create.ok) throw create.error;
    const panelId = create.value.panel.id;
    const a = await service.addOption(panelId, optionInput({ label: 'A', position: 0 }));
    if (!a.ok) throw a.error;
    await service.setCorrectOption(panelId, a.value.id);
    await service.handleSubmission({ panelId, optionId: a.value.id, userId: USER_ID });
    expect(await countRows(testDb, schema.verificationOption)).toBe(1);
    expect(await countRows(testDb, schema.verificationEvent)).toBe(1);
    const result = await service.deletePanel(panelId);
    if (!result.ok) throw result.error;
    expect(await countRows(testDb, schema.verificationPanel)).toBe(0);
    expect(await countRows(testDb, schema.verificationOption)).toBe(0);
    expect(await countRows(testDb, schema.verificationEvent)).toBe(0);
  });

  it('returns NotFoundError on unknown panel', async () => {
    const result = await service.deletePanel('missing');
    expect(result.ok).toBe(false);
  });
});

describe('VerificationService.handleSubmission', () => {
  let testDb: TestDb;
  let gateway: FakeDiscordGateway;
  let service: VerificationService;
  let panelId: string;
  let correctId: string;
  let wrongId: string;

  beforeEach(async () => {
    testDb = await createTestDb();
    gateway = new FakeDiscordGateway();
    service = new VerificationService(testDb.db, gateway, branding);
    const create = await service.createPanel(basePanel);
    if (!create.ok) throw create.error;
    panelId = create.value.panel.id;
    const correct = await service.addOption(panelId, optionInput({ label: 'C', position: 0 }));
    const wrong = await service.addOption(panelId, optionInput({ label: 'W', position: 1 }));
    if (!correct.ok || !wrong.ok) throw new Error('seed');
    correctId = correct.value.id;
    wrongId = wrong.value.id;
    await service.setCorrectOption(panelId, correctId);
  });
  afterEach(async () => {
    await testDb.close();
  });

  it('returns wrong_answer and records an event when option mismatches correct', async () => {
    const result = await service.handleSubmission({ panelId, optionId: wrongId, userId: USER_ID });
    if (!result.ok) throw result.error;
    expect(result.value.outcome).toBe(VerificationOutcome.wrongAnswer);
    expect(gateway.callsOf('assignRoleToMember')).toHaveLength(0);
    const events = await service.listEvents(panelId);
    expect(events.map((e) => e.outcome)).toEqual([VerificationOutcome.wrongAnswer]);
  });

  it('returns success and assigns the role on first correct click', async () => {
    const result = await service.handleSubmission({
      panelId,
      optionId: correctId,
      userId: USER_ID,
    });
    if (!result.ok) throw result.error;
    expect(result.value.outcome).toBe(VerificationOutcome.success);
    expect(result.value.roleId).toBe(ROLE_ID);
    expect(gateway.callsOf('assignRoleToMember')).toHaveLength(1);
    const events = await service.listEvents(panelId);
    expect(events.map((e) => e.outcome)).toEqual([VerificationOutcome.success]);
  });

  it('returns already_verified on a second correct click after success', async () => {
    await service.handleSubmission({ panelId, optionId: correctId, userId: USER_ID });
    gateway.reset();
    const second = await service.handleSubmission({
      panelId,
      optionId: correctId,
      userId: USER_ID,
    });
    if (!second.ok) throw second.error;
    expect(second.value.outcome).toBe(VerificationOutcome.alreadyVerified);
    // Should NOT call assignRoleToMember a second time.
    expect(gateway.callsOf('assignRoleToMember')).toHaveLength(0);
  });

  it('returns already_verified when the user already had the role pre-flight', async () => {
    gateway = new FakeDiscordGateway({
      memberRoles: new Set([`${GUILD_ID}:${USER_ID}:${ROLE_ID}`]),
    });
    service = new VerificationService(testDb.db, gateway, branding);
    const result = await service.handleSubmission({
      panelId,
      optionId: correctId,
      userId: USER_ID,
    });
    if (!result.ok) throw result.error;
    expect(result.value.outcome).toBe(VerificationOutcome.alreadyVerified);
    expect(gateway.callsOf('assignRoleToMember')).toHaveLength(0);
  });

  it('returns role_assign_failed when Discord rejects with a permission error', async () => {
    gateway = new FakeDiscordGateway({ failRoleAssignAsDiscordError: true });
    service = new VerificationService(testDb.db, gateway, branding);
    const result = await service.handleSubmission({
      panelId,
      optionId: correctId,
      userId: USER_ID,
    });
    if (!result.ok) throw result.error;
    expect(result.value.outcome).toBe(VerificationOutcome.roleAssignFailed);
    const events = await service.listEvents(panelId);
    expect(events.map((e) => e.outcome)).toEqual([VerificationOutcome.roleAssignFailed]);
  });

  it('returns NotFoundError when panel is missing', async () => {
    const result = await service.handleSubmission({
      panelId: 'missing',
      optionId: correctId,
      userId: USER_ID,
    });
    expect(result.ok).toBe(false);
  });

  it('returns NotFoundError when option belongs to a different panel', async () => {
    const otherPanelCreate = await testDb.db
      .insert(schema.verificationPanel)
      .values({
        guildId: GUILD_ID,
        channelId: '999999999999999999',
        messageId: 'pending',
        embedTitle: 'X',
        embedDescription: 'Y',
        roleId: ROLE_ID,
      })
      .returning();
    const otherPanelId = otherPanelCreate[0]?.id;
    if (otherPanelId === undefined) throw new Error('seed');
    const result = await service.handleSubmission({
      panelId: otherPanelId,
      optionId: correctId,
      userId: USER_ID,
    });
    expect(result.ok).toBe(false);
  });
});

describe('VerificationService.listEvents / countEvents', () => {
  let testDb: TestDb;
  let service: VerificationService;
  let panelId: string;
  let correctId: string;

  beforeEach(async () => {
    testDb = await createTestDb();
    service = new VerificationService(testDb.db, new FakeDiscordGateway(), branding);
    const create = await service.createPanel(basePanel);
    if (!create.ok) throw create.error;
    panelId = create.value.panel.id;
    const correct = await service.addOption(panelId, optionInput({ label: 'C' }));
    if (!correct.ok) throw correct.error;
    correctId = correct.value.id;
    await service.setCorrectOption(panelId, correctId);
  });
  afterEach(async () => {
    await testDb.close();
  });

  it('returns events scoped to the given panel', async () => {
    await service.handleSubmission({ panelId, optionId: correctId, userId: USER_ID });
    await service.handleSubmission({ panelId, optionId: correctId, userId: USER_ID });
    expect(await service.countEvents(panelId)).toBe(2);
    const events = await service.listEvents(panelId);
    expect(events).toHaveLength(2);
  });
});
