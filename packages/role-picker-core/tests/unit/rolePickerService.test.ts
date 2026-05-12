import { eq, RolePickerAction, schema } from '@hearth/database';
import { ConflictError, NotFoundError, ValidationError } from '@hearth/shared';
import { afterEach, describe, expect, it } from 'vitest';

import { RolePickerService } from '../../src/rolePickerService.js';
import { FakeDiscordGateway } from '../helpers/fakeGateway.js';
import { branding } from '../helpers/testBranding.js';
import { createTestDb, type TestDb } from '../helpers/testDb.js';

// Service-level tests with a real PGlite Postgres + a fake gateway
// satisfying the composite DiscordGateway. Covers panel CRUD + option
// CRUD + the diff-based selection logic that's unique to role-picker.

interface Harness {
  readonly testDb: TestDb;
  readonly gateway: FakeDiscordGateway;
  readonly service: RolePickerService;
}

async function setup(
  options?: ConstructorParameters<typeof FakeDiscordGateway>[0],
): Promise<Harness> {
  const testDb = await createTestDb();
  const gateway = new FakeDiscordGateway(options);
  const service = new RolePickerService(testDb.db, gateway, branding);
  return { testDb, gateway, service };
}

const GUILD = '1111111111111111111';
const CHANNEL = '2222222222222222222';
const ROLE_KO = '3333333333333331111';
const ROLE_EN = '3333333333333332222';
const ROLE_JP = '3333333333333333333';
const USER_A = '4444444444444444444';
const USER_B = '5555555555555555555';

function panelInput(overrides: Partial<{ channelId: string }> = {}) {
  return {
    guildId: GUILD,
    channelId: overrides.channelId ?? CHANNEL,
    embedTitle: 'Pick your language',
    embedDescription: 'Choose one option from the dropdown.',
  };
}

describe('RolePickerService.createPanel', () => {
  let harness: Harness | undefined;
  afterEach(async () => {
    if (harness !== undefined) {
      await harness.testDb.close();
      harness = undefined;
    }
  });

  it('inserts a row with the placeholder messageId and an encoded customId', async () => {
    harness = await setup();
    const res = await harness.service.createPanel(panelInput());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.panel.messageId).toBe('pending');
    expect(res.value.panel.customId).toMatch(/^role-picker:submit\|/);
    expect(res.value.panel.customId).toContain(`"panelId":"${res.value.panel.id}"`);
  });

  it('defaults selectionMode / minValues / maxValues to single / 1 / 1', async () => {
    harness = await setup();
    const res = await harness.service.createPanel(panelInput());
    if (!res.ok) throw res.error;
    expect(res.value.panel.selectionMode).toBe('single');
    expect(res.value.panel.minValues).toBe(1);
    expect(res.value.panel.maxValues).toBe(1);
  });

  it('rejects when another panel on the same channel is still pending publish', async () => {
    harness = await setup();
    await harness.service.createPanel(panelInput());
    const second = await harness.service.createPanel(panelInput());
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toBeInstanceOf(ConflictError);
  });
});

describe('RolePickerService.addOption', () => {
  let harness: Harness | undefined;
  afterEach(async () => {
    if (harness !== undefined) {
      await harness.testDb.close();
      harness = undefined;
    }
  });

  async function seedPanel(): Promise<string> {
    const res = await harness!.service.createPanel(panelInput());
    if (!res.ok) throw res.error;
    return res.value.panel.id;
  }

  it('inserts an option with the given label / role / position', async () => {
    harness = await setup();
    const panelId = await seedPanel();
    const res = await harness.service.addOption(panelId, {
      label: 'Korean',
      emoji: '🇰🇷',
      roleId: ROLE_KO,
      position: 0,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.label).toBe('Korean');
    expect(res.value.roleId).toBe(ROLE_KO);
    expect(res.value.position).toBe(0);
  });

  it('rejects duplicate labels on the same panel', async () => {
    harness = await setup();
    const panelId = await seedPanel();
    await harness.service.addOption(panelId, {
      label: 'Korean',
      roleId: ROLE_KO,
      position: 0,
    });
    const dup = await harness.service.addOption(panelId, {
      label: 'Korean',
      roleId: ROLE_EN,
      position: 1,
    });
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error).toBeInstanceOf(ConflictError);
  });

  it('rejects two options binding the same role on one panel', async () => {
    harness = await setup();
    const panelId = await seedPanel();
    await harness.service.addOption(panelId, {
      label: 'Korean',
      roleId: ROLE_KO,
      position: 0,
    });
    const dup = await harness.service.addOption(panelId, {
      label: 'Korean (alt)',
      roleId: ROLE_KO,
      position: 1,
    });
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error).toBeInstanceOf(ConflictError);
  });

  it('rejects duplicate positions on the same panel', async () => {
    harness = await setup();
    const panelId = await seedPanel();
    await harness.service.addOption(panelId, {
      label: 'Korean',
      roleId: ROLE_KO,
      position: 0,
    });
    const dup = await harness.service.addOption(panelId, {
      label: 'English',
      roleId: ROLE_EN,
      position: 0,
    });
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error).toBeInstanceOf(ConflictError);
  });

  it('rejects positions outside 0..24', async () => {
    harness = await setup();
    const panelId = await seedPanel();
    const out = await harness.service.addOption(panelId, {
      label: 'Korean',
      roleId: ROLE_KO,
      position: 25,
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toBeInstanceOf(ValidationError);
  });

  it('rejects when the panel is not found', async () => {
    harness = await setup();
    const res = await harness.service.addOption('missing-panel', {
      label: 'X',
      roleId: ROLE_KO,
      position: 0,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBeInstanceOf(NotFoundError);
  });

  it('accepts options without emoji or description', async () => {
    harness = await setup();
    const panelId = await seedPanel();
    const res = await harness.service.addOption(panelId, {
      label: 'Plain',
      roleId: ROLE_KO,
      position: 0,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.emoji).toBeNull();
    expect(res.value.description).toBeNull();
  });
});

describe('RolePickerService.editOption', () => {
  let harness: Harness | undefined;
  afterEach(async () => {
    if (harness !== undefined) {
      await harness.testDb.close();
      harness = undefined;
    }
  });

  it('updates label / description / position individually', async () => {
    harness = await setup();
    const panelRes = await harness.service.createPanel(panelInput());
    if (!panelRes.ok) throw panelRes.error;
    const opt = await harness.service.addOption(panelRes.value.panel.id, {
      label: 'Korean',
      emoji: '🇰🇷',
      roleId: ROLE_KO,
      position: 0,
    });
    if (!opt.ok) throw opt.error;
    const res = await harness.service.editOption(opt.value.id, {
      label: 'Korean (한국어)',
      description: 'Korean role',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.label).toBe('Korean (한국어)');
    expect(res.value.description).toBe('Korean role');
  });

  it('rejects position collisions on the same panel', async () => {
    harness = await setup();
    const panelRes = await harness.service.createPanel(panelInput());
    if (!panelRes.ok) throw panelRes.error;
    const a = await harness.service.addOption(panelRes.value.panel.id, {
      label: 'A',
      roleId: ROLE_KO,
      position: 0,
    });
    const b = await harness.service.addOption(panelRes.value.panel.id, {
      label: 'B',
      roleId: ROLE_EN,
      position: 1,
    });
    if (!a.ok || !b.ok) throw new Error('seed');
    const res = await harness.service.editOption(b.value.id, { position: 0 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBeInstanceOf(ConflictError);
  });
});

describe('RolePickerService.handleSelection', () => {
  let harness: Harness | undefined;
  afterEach(async () => {
    if (harness !== undefined) {
      await harness.testDb.close();
      harness = undefined;
    }
  });

  async function seedThreeOptions(): Promise<{
    panelId: string;
    optionKoId: string;
    optionEnId: string;
    optionJpId: string;
  }> {
    const panelRes = await harness!.service.createPanel(panelInput());
    if (!panelRes.ok) throw panelRes.error;
    const ko = await harness!.service.addOption(panelRes.value.panel.id, {
      label: 'Korean',
      emoji: '🇰🇷',
      roleId: ROLE_KO,
      position: 0,
    });
    const en = await harness!.service.addOption(panelRes.value.panel.id, {
      label: 'English',
      emoji: '🇺🇸',
      roleId: ROLE_EN,
      position: 1,
    });
    const jp = await harness!.service.addOption(panelRes.value.panel.id, {
      label: 'Japanese',
      emoji: '🇯🇵',
      roleId: ROLE_JP,
      position: 2,
    });
    if (!ko.ok || !en.ok || !jp.ok) throw new Error('seed');
    return {
      panelId: panelRes.value.panel.id,
      optionKoId: ko.value.id,
      optionEnId: en.value.id,
      optionJpId: jp.value.id,
    };
  }

  it('grants a single role when the user picks a new option', async () => {
    harness = await setup();
    const { panelId, optionKoId } = await seedThreeOptions();
    const res = await harness.service.handleSelection({
      panelId,
      userId: USER_A,
      selectedValues: [optionKoId],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.grantedCount).toBe(1);
    expect(res.value.revokedCount).toBe(0);
    expect(res.value.failedCount).toBe(0);
    expect(res.value.grantedLabels).toEqual(['Korean']);

    const events = await harness.testDb.db
      .select()
      .from(schema.rolePickerEvent)
      .where(eq(schema.rolePickerEvent.panelId, panelId));
    expect(events).toHaveLength(1);
    expect(events[0]?.action).toBe(RolePickerAction.granted);
    expect(events[0]?.optionLabel).toBe('Korean');
  });

  it('swaps roles on re-selection — revokes the old, grants the new', async () => {
    harness = await setup();
    const { panelId, optionKoId, optionEnId } = await seedThreeOptions();
    await harness.service.handleSelection({
      panelId,
      userId: USER_A,
      selectedValues: [optionKoId],
    });
    const res = await harness.service.handleSelection({
      panelId,
      userId: USER_A,
      selectedValues: [optionEnId],
    });
    if (!res.ok) throw res.error;
    expect(res.value.grantedCount).toBe(1);
    expect(res.value.revokedCount).toBe(1);
    expect(res.value.grantedLabels).toEqual(['English']);
    expect(res.value.revokedLabels).toEqual(['Korean']);
  });

  it('is a no-op when the user re-selects what they already hold', async () => {
    harness = await setup();
    const { panelId, optionKoId } = await seedThreeOptions();
    await harness.service.handleSelection({
      panelId,
      userId: USER_A,
      selectedValues: [optionKoId],
    });
    const res = await harness.service.handleSelection({
      panelId,
      userId: USER_A,
      selectedValues: [optionKoId],
    });
    if (!res.ok) throw res.error;
    expect(res.value.grantedCount).toBe(0);
    expect(res.value.revokedCount).toBe(0);
    expect(res.value.failedCount).toBe(0);
  });

  it('emits role_assign_failed audit when the gateway rejects the grant', async () => {
    harness = await setup({ failAssignAsDiscordError: true });
    const { panelId, optionKoId } = await seedThreeOptions();
    const res = await harness.service.handleSelection({
      panelId,
      userId: USER_A,
      selectedValues: [optionKoId],
    });
    if (!res.ok) throw res.error;
    expect(res.value.grantedCount).toBe(0);
    expect(res.value.failedCount).toBe(1);

    const events = await harness.testDb.db
      .select()
      .from(schema.rolePickerEvent)
      .where(eq(schema.rolePickerEvent.panelId, panelId));
    expect(events).toHaveLength(1);
    expect(events[0]?.action).toBe(RolePickerAction.roleAssignFailed);
  });

  it('emits role_revoke_failed audit when the gateway rejects the revoke', async () => {
    harness = await setup();
    const { panelId, optionKoId } = await seedThreeOptions();
    // Grant first (so the user has currentlyHeld state)
    await harness.service.handleSelection({
      panelId,
      userId: USER_A,
      selectedValues: [optionKoId],
    });
    // Re-setup with revoke failure — the fake gateway's options are
    // construction-time only, so we tear down + rebuild rather than
    // mutating.
    await harness.testDb.close();
    harness = await setup({ failRemoveAsDiscordError: true });
    const fresh = await seedThreeOptions();
    // Grant first to seed audit log (assign path still succeeds —
    // failRemoveAsDiscordError only flips removeRoleFromMember).
    await harness.service.handleSelection({
      panelId: fresh.panelId,
      userId: USER_A,
      selectedValues: [fresh.optionKoId],
    });
    // Then attempt to clear selection — revoke should fail
    const res = await harness.service.handleSelection({
      panelId: fresh.panelId,
      userId: USER_A,
      selectedValues: [],
    });
    if (!res.ok) throw res.error;
    expect(res.value.revokedCount).toBe(0);
    expect(res.value.failedCount).toBe(1);

    const failure = await harness.testDb.db
      .select()
      .from(schema.rolePickerEvent)
      .where(eq(schema.rolePickerEvent.action, RolePickerAction.roleRevokeFailed));
    expect(failure).toHaveLength(1);
  });

  it('returns empty result when the panel id is unknown', async () => {
    harness = await setup();
    const res = await harness.service.handleSelection({
      panelId: 'unknown-panel',
      userId: USER_A,
      selectedValues: ['anything'],
    });
    if (!res.ok) throw res.error;
    expect(res.value.grantedCount).toBe(0);
    expect(res.value.revokedCount).toBe(0);
  });

  it('returns empty result when a selected value does not exist on the panel (stale client)', async () => {
    harness = await setup();
    const { panelId } = await seedThreeOptions();
    const res = await harness.service.handleSelection({
      panelId,
      userId: USER_A,
      selectedValues: ['phantom-option-id'],
    });
    if (!res.ok) throw res.error;
    expect(res.value.grantedCount).toBe(0);
    expect(res.value.failedCount).toBe(0);
  });

  it('does not double-grant when the audit log already has a matching granted row', async () => {
    harness = await setup();
    const { panelId, optionKoId } = await seedThreeOptions();
    await harness.service.handleSelection({
      panelId,
      userId: USER_A,
      selectedValues: [optionKoId],
    });
    harness.gateway.reset();
    const res = await harness.service.handleSelection({
      panelId,
      userId: USER_A,
      selectedValues: [optionKoId],
    });
    if (!res.ok) throw res.error;
    expect(harness.gateway.callsOf('assignRoleToMember')).toHaveLength(0);
    expect(res.value.grantedCount).toBe(0);
  });

  it('isolates state between users — A grants do not affect B', async () => {
    harness = await setup();
    const { panelId, optionKoId } = await seedThreeOptions();
    await harness.service.handleSelection({
      panelId,
      userId: USER_A,
      selectedValues: [optionKoId],
    });
    const res = await harness.service.handleSelection({
      panelId,
      userId: USER_B,
      selectedValues: [optionKoId],
    });
    if (!res.ok) throw res.error;
    expect(res.value.grantedCount).toBe(1);
  });

  it('handles a multi-select grant + revoke in one submission (forward-compat)', async () => {
    harness = await setup();
    const { panelId, optionKoId, optionEnId, optionJpId } = await seedThreeOptions();
    // Seed: user holds KO + EN
    await harness.service.handleSelection({
      panelId,
      userId: USER_A,
      selectedValues: [optionKoId, optionEnId],
    });
    // Now flip to JP only — should revoke KO + EN, grant JP
    const res = await harness.service.handleSelection({
      panelId,
      userId: USER_A,
      selectedValues: [optionJpId],
    });
    if (!res.ok) throw res.error;
    expect(res.value.grantedCount).toBe(1);
    expect(res.value.revokedCount).toBe(2);
    expect(res.value.grantedLabels).toEqual(['Japanese']);
    expect(new Set(res.value.revokedLabels)).toEqual(new Set(['Korean', 'English']));
  });
});

describe('RolePickerService.renderPanel', () => {
  let harness: Harness | undefined;
  afterEach(async () => {
    if (harness !== undefined) {
      await harness.testDb.close();
      harness = undefined;
    }
  });

  it('rejects render when the panel has no options', async () => {
    harness = await setup();
    const create = await harness.service.createPanel(panelInput());
    if (!create.ok) throw create.error;
    const res = await harness.service.renderPanel(create.value.panel.id);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBeInstanceOf(ValidationError);
  });

  it('sends a fresh message and patches the messageId on first render', async () => {
    harness = await setup({ nextMessageId: () => 'msg-fresh' });
    const create = await harness.service.createPanel(panelInput());
    if (!create.ok) throw create.error;
    await harness.service.addOption(create.value.panel.id, {
      label: 'Korean',
      roleId: ROLE_KO,
      position: 0,
    });
    const res = await harness.service.renderPanel(create.value.panel.id);
    if (!res.ok) throw res.error;
    expect(res.value.messageId).toBe('msg-fresh');
    expect(res.value.recreated).toBe(true);
    expect(harness.gateway.callsOf('sendRolePickerMessage')).toHaveLength(1);
  });

  it('edits the existing message on subsequent renders', async () => {
    harness = await setup({ nextMessageId: () => 'msg-1' });
    const create = await harness.service.createPanel(panelInput());
    if (!create.ok) throw create.error;
    await harness.service.addOption(create.value.panel.id, {
      label: 'Korean',
      roleId: ROLE_KO,
      position: 0,
    });
    await harness.service.renderPanel(create.value.panel.id);
    harness.gateway.reset();
    const res = await harness.service.renderPanel(create.value.panel.id);
    if (!res.ok) throw res.error;
    expect(res.value.recreated).toBe(false);
    expect(harness.gateway.callsOf('editRolePickerMessage')).toHaveLength(1);
    expect(harness.gateway.callsOf('sendRolePickerMessage')).toHaveLength(0);
  });
});

describe('RolePickerService.repostPanel', () => {
  let harness: Harness | undefined;
  afterEach(async () => {
    if (harness !== undefined) {
      await harness.testDb.close();
      harness = undefined;
    }
  });

  it('deletes the previous message and posts a new one', async () => {
    harness = await setup({
      nextMessageId: (() => {
        let n = 0;
        return () => `msg-${String(++n)}`;
      })(),
    });
    const create = await harness.service.createPanel(panelInput());
    if (!create.ok) throw create.error;
    await harness.service.addOption(create.value.panel.id, {
      label: 'Korean',
      roleId: ROLE_KO,
      position: 0,
    });
    await harness.service.renderPanel(create.value.panel.id);
    const res = await harness.service.repostPanel(create.value.panel.id);
    if (!res.ok) throw res.error;
    expect(res.value.messageId).toBe('msg-2');
    expect(res.value.previousMessageId).toBe('msg-1');
    expect(harness.gateway.callsOf('deleteRolePickerMessage')).toHaveLength(1);
  });
});

describe('RolePickerService.deletePanel', () => {
  let harness: Harness | undefined;
  afterEach(async () => {
    if (harness !== undefined) {
      await harness.testDb.close();
      harness = undefined;
    }
  });

  it('removes the row and cascades to options + events', async () => {
    harness = await setup();
    const create = await harness.service.createPanel(panelInput());
    if (!create.ok) throw create.error;
    await harness.service.addOption(create.value.panel.id, {
      label: 'Korean',
      roleId: ROLE_KO,
      position: 0,
    });
    const res = await harness.service.deletePanel(create.value.panel.id);
    expect(res.ok).toBe(true);
    const panels = await harness.testDb.db
      .select()
      .from(schema.rolePickerPanel)
      .where(eq(schema.rolePickerPanel.id, create.value.panel.id));
    expect(panels).toHaveLength(0);
    const options = await harness.testDb.db
      .select()
      .from(schema.rolePickerOption)
      .where(eq(schema.rolePickerOption.panelId, create.value.panel.id));
    expect(options).toHaveLength(0);
  });
});

describe('RolePickerService.getOptionHolders + revokeRoleFromOptionHolders', () => {
  let harness: Harness | undefined;
  afterEach(async () => {
    if (harness !== undefined) {
      await harness.testDb.close();
      harness = undefined;
    }
  });

  it('lists holders by net-positive grant aggregation', async () => {
    harness = await setup();
    const create = await harness.service.createPanel(panelInput());
    if (!create.ok) throw create.error;
    const opt = await harness.service.addOption(create.value.panel.id, {
      label: 'Korean',
      roleId: ROLE_KO,
      position: 0,
    });
    if (!opt.ok) throw opt.error;
    // USER_A grants then keeps; USER_B grants then revokes (net 0).
    await harness.service.handleSelection({
      panelId: create.value.panel.id,
      userId: USER_A,
      selectedValues: [opt.value.id],
    });
    await harness.service.handleSelection({
      panelId: create.value.panel.id,
      userId: USER_B,
      selectedValues: [opt.value.id],
    });
    await harness.service.handleSelection({
      panelId: create.value.panel.id,
      userId: USER_B,
      selectedValues: [],
    });
    const holders = await harness.service.getOptionHolders(opt.value.id);
    expect([...holders]).toEqual([USER_A]);
  });

  it('revokes the role from each holder and reports the count', async () => {
    harness = await setup();
    const create = await harness.service.createPanel(panelInput());
    if (!create.ok) throw create.error;
    const opt = await harness.service.addOption(create.value.panel.id, {
      label: 'Korean',
      roleId: ROLE_KO,
      position: 0,
    });
    if (!opt.ok) throw opt.error;
    await harness.service.handleSelection({
      panelId: create.value.panel.id,
      userId: USER_A,
      selectedValues: [opt.value.id],
    });
    await harness.service.handleSelection({
      panelId: create.value.panel.id,
      userId: USER_B,
      selectedValues: [opt.value.id],
    });
    harness.gateway.reset();
    const res = await harness.service.revokeRoleFromOptionHolders(opt.value.id);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.revokedCount).toBe(2);
    expect(harness.gateway.callsOf('removeRoleFromMember')).toHaveLength(2);
  });
});

describe('Audit-log retention', () => {
  let harness: Harness | undefined;
  afterEach(async () => {
    if (harness !== undefined) {
      await harness.testDb.close();
      harness = undefined;
    }
  });

  it('preserves snapshot columns when the option is deleted', async () => {
    harness = await setup();
    const create = await harness.service.createPanel(panelInput());
    if (!create.ok) throw create.error;
    const opt = await harness.service.addOption(create.value.panel.id, {
      label: 'Korean',
      emoji: '🇰🇷',
      roleId: ROLE_KO,
      position: 0,
    });
    if (!opt.ok) throw opt.error;
    await harness.service.handleSelection({
      panelId: create.value.panel.id,
      userId: USER_A,
      selectedValues: [opt.value.id],
    });
    await harness.service.removeOption(opt.value.id);
    const events = await harness.testDb.db
      .select()
      .from(schema.rolePickerEvent)
      .where(eq(schema.rolePickerEvent.panelId, create.value.panel.id));
    expect(events).toHaveLength(1);
    expect(events[0]?.optionId).toBeNull();
    expect(events[0]?.optionLabel).toBe('Korean');
    expect(events[0]?.optionEmoji).toBe('🇰🇷');
    expect(events[0]?.optionRoleId).toBe(ROLE_KO);
  });
});
