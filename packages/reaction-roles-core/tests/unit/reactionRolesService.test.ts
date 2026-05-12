import { count, eq, schema, ReactionRolesAction } from '@hearth/database';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  type ReactionRolesOptionInput,
  type ReactionRolesPanelInput,
  ReactionRolesService,
} from '../../src/reactionRolesService.js';
import { FakeDiscordGateway } from '../helpers/fakeGateway.js';
import { branding } from '../helpers/testBranding.js';
import { createTestDb, type TestDb } from '../helpers/testDb.js';

const GUILD_ID = '111111111111111111';
const CHANNEL_ID = '222222222222222222';
const USER_ID = '444444444444444444';

const ROLE_US = '555555555555555551';
const ROLE_KR = '555555555555555552';
const ROLE_JP = '555555555555555553';

const basePanel: ReactionRolesPanelInput = {
  guildId: GUILD_ID,
  channelId: CHANNEL_ID,
  embedTitle: 'Languages',
  embedDescription: 'Pick the flags you read.',
};

function optionInput(overrides: Partial<ReactionRolesOptionInput> = {}): ReactionRolesOptionInput {
  return {
    label: 'English',
    emoji: '🇺🇸',
    roleId: ROLE_US,
    position: 0,
    ...overrides,
  };
}

async function countRows(
  testDb: TestDb,
  table:
    | typeof schema.reactionRolesPanel
    | typeof schema.reactionRolesOption
    | typeof schema.reactionRolesEvent,
): Promise<number> {
  const [row] = await testDb.db.select({ value: count() }).from(table);
  return row?.value ?? 0;
}

// ─────────────────────── createPanel ───────────────────────

describe('ReactionRolesService.createPanel', () => {
  let testDb: TestDb;
  let gateway: FakeDiscordGateway;
  let service: ReactionRolesService;

  beforeEach(async () => {
    testDb = await createTestDb();
    gateway = new FakeDiscordGateway();
    service = new ReactionRolesService(testDb.db, gateway, branding);
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
    expect(await countRows(testDb, schema.reactionRolesPanel)).toBe(1);
    expect(await countRows(testDb, schema.reactionRolesOption)).toBe(0);
    expect(gateway.calls).toEqual([]);
  });

  it('falls back to default copy when title/description are omitted', async () => {
    const result = await service.createPanel({ guildId: GUILD_ID, channelId: CHANNEL_ID });
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.value.panel.embedTitle.length).toBeGreaterThan(0);
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

// ─────────────────────── editPanel ───────────────────────

describe('ReactionRolesService.editPanel', () => {
  let testDb: TestDb;
  let gateway: FakeDiscordGateway;
  let service: ReactionRolesService;
  let panelId: string;

  beforeEach(async () => {
    testDb = await createTestDb();
    gateway = new FakeDiscordGateway();
    service = new ReactionRolesService(testDb.db, gateway, branding);
    const created = await service.createPanel(basePanel);
    if (!created.ok) throw created.error;
    panelId = created.value.panel.id;
  });
  afterEach(async () => {
    await testDb.close();
  });

  it('updates the supplied fields and leaves others untouched', async () => {
    const result = await service.editPanel(panelId, { embedTitle: 'New title' });
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.value.embedTitle).toBe('New title');
    expect(result.value.embedDescription).toBe(basePanel.embedDescription);
  });

  it('is a no-op when no fields are provided', async () => {
    const before = await service.getPanel(panelId);
    if (!before.ok) throw before.error;
    const result = await service.editPanel(panelId, {});
    if (!result.ok) throw result.error;
    expect(result.value.embedTitle).toBe(before.value.embedTitle);
  });

  it('returns NotFoundError for an unknown panel', async () => {
    const result = await service.editPanel('does-not-exist', { embedTitle: 'x' });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected NotFoundError');
    expect(result.error.code).toBe('NOT_FOUND');
  });
});

// ─────────────────────── list / get ───────────────────────

describe('ReactionRolesService.listPanels / getPanel', () => {
  let testDb: TestDb;
  let gateway: FakeDiscordGateway;
  let service: ReactionRolesService;

  beforeEach(async () => {
    testDb = await createTestDb();
    gateway = new FakeDiscordGateway();
    service = new ReactionRolesService(testDb.db, gateway, branding);
  });
  afterEach(async () => {
    await testDb.close();
  });

  it('lists only panels belonging to the requested guild', async () => {
    await service.createPanel(basePanel);
    await service.createPanel({ ...basePanel, guildId: '999999999999999999' });
    const rows = await service.listPanels(GUILD_ID);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.guildId).toBe(GUILD_ID);
  });

  it('getPanel returns the panel with options sorted by position', async () => {
    const created = await service.createPanel(basePanel);
    if (!created.ok) throw created.error;
    await service.addOption(
      created.value.panel.id,
      optionInput({ position: 2, label: 'Jpn', emoji: '🇯🇵', roleId: ROLE_JP }),
    );
    await service.addOption(
      created.value.panel.id,
      optionInput({ position: 0, label: 'Eng', emoji: '🇺🇸' }),
    );
    await service.addOption(
      created.value.panel.id,
      optionInput({ position: 1, label: 'Kor', emoji: '🇰🇷', roleId: ROLE_KR }),
    );
    const got = await service.getPanel(created.value.panel.id);
    if (!got.ok) throw got.error;
    expect(got.value.options.map((o) => o.position)).toEqual([0, 1, 2]);
  });

  it('getPanel returns NotFoundError for an unknown panel', async () => {
    const result = await service.getPanel('nope');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected NotFoundError');
    expect(result.error.code).toBe('NOT_FOUND');
  });
});

// ─────────────────────── addOption ───────────────────────

describe('ReactionRolesService.addOption', () => {
  let testDb: TestDb;
  let gateway: FakeDiscordGateway;
  let service: ReactionRolesService;
  let panelId: string;

  beforeEach(async () => {
    testDb = await createTestDb();
    gateway = new FakeDiscordGateway();
    service = new ReactionRolesService(testDb.db, gateway, branding);
    const created = await service.createPanel(basePanel);
    if (!created.ok) throw created.error;
    panelId = created.value.panel.id;
  });
  afterEach(async () => {
    await testDb.close();
  });

  it('adds an option with the given emoji/role/position', async () => {
    const result = await service.addOption(panelId, optionInput());
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.value.emoji).toBe('🇺🇸');
    expect(result.value.roleId).toBe(ROLE_US);
  });

  it('rejects when the panel is full (20 options — Discord cap)', async () => {
    for (let i = 0; i < 20; i++) {
      await service.addOption(
        panelId,
        optionInput({
          label: `Opt-${String(i)}`,
          emoji: `e${String(i)}`,
          position: i,
        }),
      );
    }
    const overflow = await service.addOption(
      panelId,
      optionInput({ label: 'Twenty-first', emoji: 'e20', position: 20 }),
    );
    expect(overflow.ok).toBe(false);
  });

  it('rejects a duplicate emoji on the same panel', async () => {
    await service.addOption(panelId, optionInput());
    const dup = await service.addOption(
      panelId,
      optionInput({ label: 'Different label', position: 1 }),
    );
    expect(dup.ok).toBe(false);
    if (dup.ok) throw new Error('expected ConflictError');
    expect(dup.error.code).toBe('CONFLICT');
  });

  it('rejects a duplicate label on the same panel', async () => {
    await service.addOption(panelId, optionInput());
    const dup = await service.addOption(
      panelId,
      optionInput({ emoji: '🇰🇷', roleId: ROLE_KR, position: 1 }),
    );
    expect(dup.ok).toBe(false);
    if (dup.ok) throw new Error('expected ConflictError');
    expect(dup.error.code).toBe('CONFLICT');
  });

  it('rejects a duplicate position on the same panel', async () => {
    await service.addOption(panelId, optionInput());
    const dup = await service.addOption(
      panelId,
      optionInput({ label: 'Other', emoji: '🇰🇷', roleId: ROLE_KR, position: 0 }),
    );
    expect(dup.ok).toBe(false);
    if (dup.ok) throw new Error('expected ConflictError');
    expect(dup.error.code).toBe('CONFLICT');
  });

  it('rejects an out-of-range position', async () => {
    const result = await service.addOption(panelId, optionInput({ position: 99 }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected ValidationError');
    expect(result.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns NotFoundError when the parent panel is missing', async () => {
    const result = await service.addOption('nope', optionInput());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected NotFoundError');
    expect(result.error.code).toBe('NOT_FOUND');
  });
});

// ─────────────────────── editOption / removeOption ───────────────────────

describe('ReactionRolesService.editOption / removeOption', () => {
  let testDb: TestDb;
  let gateway: FakeDiscordGateway;
  let service: ReactionRolesService;
  let panelId: string;
  let optionAId: string;
  let optionBId: string;

  beforeEach(async () => {
    testDb = await createTestDb();
    gateway = new FakeDiscordGateway();
    service = new ReactionRolesService(testDb.db, gateway, branding);
    const created = await service.createPanel(basePanel);
    if (!created.ok) throw created.error;
    panelId = created.value.panel.id;
    const a = await service.addOption(panelId, optionInput());
    const b = await service.addOption(
      panelId,
      optionInput({ label: 'Korean', emoji: '🇰🇷', roleId: ROLE_KR, position: 1 }),
    );
    if (!a.ok) throw a.error;
    if (!b.ok) throw b.error;
    optionAId = a.value.id;
    optionBId = b.value.id;
  });
  afterEach(async () => {
    await testDb.close();
  });

  it('updates only the supplied fields', async () => {
    const result = await service.editOption(optionAId, { label: 'English (US)' });
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.value.label).toBe('English (US)');
    expect(result.value.emoji).toBe('🇺🇸');
  });

  it('rejects when changing emoji to one already on the panel', async () => {
    const result = await service.editOption(optionAId, { emoji: '🇰🇷' });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected ConflictError');
    expect(result.error.code).toBe('CONFLICT');
  });

  it('rejects when changing position to one already in use', async () => {
    const result = await service.editOption(optionAId, { position: 1 });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected ConflictError');
    expect(result.error.code).toBe('CONFLICT');
  });

  it('removeOption deletes the row and cascades nothing else', async () => {
    const result = await service.removeOption(optionBId);
    expect(result.ok).toBe(true);
    expect(await countRows(testDb, schema.reactionRolesOption)).toBe(1);
    expect(await countRows(testDb, schema.reactionRolesPanel)).toBe(1);
  });

  it('removeOption returns NotFoundError for an unknown id', async () => {
    const result = await service.removeOption('nope');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected NotFoundError');
    expect(result.error.code).toBe('NOT_FOUND');
  });
});

// ─────────────────────── renderPanel / repostPanel ───────────────────────

describe('ReactionRolesService.renderPanel / repostPanel', () => {
  let testDb: TestDb;
  let gateway: FakeDiscordGateway;
  let service: ReactionRolesService;
  let panelId: string;

  beforeEach(async () => {
    testDb = await createTestDb();
    gateway = new FakeDiscordGateway();
    service = new ReactionRolesService(testDb.db, gateway, branding);
    const created = await service.createPanel(basePanel);
    if (!created.ok) throw created.error;
    panelId = created.value.panel.id;
  });
  afterEach(async () => {
    await testDb.close();
  });

  it('sends the message and seeds reactions on first render', async () => {
    await service.addOption(panelId, optionInput());
    await service.addOption(
      panelId,
      optionInput({ label: 'Korean', emoji: '🇰🇷', roleId: ROLE_KR, position: 1 }),
    );
    const result = await service.renderPanel(panelId);
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.value.recreated).toBe(true);
    expect(gateway.callsOf('sendReactionRolesMessage')).toHaveLength(1);
    const reactions = gateway.callsOf('syncBotReactions');
    expect(reactions).toHaveLength(1);
    expect((reactions[0]?.args as { desiredEmojis: string[] }).desiredEmojis).toEqual(['🇺🇸', '🇰🇷']);
  });

  it('edits in place when the panel already has a real messageId', async () => {
    await service.addOption(panelId, optionInput());
    await service.renderPanel(panelId);
    gateway.reset();
    const result = await service.renderPanel(panelId);
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.value.recreated).toBe(false);
    expect(gateway.callsOf('editReactionRolesMessage')).toHaveLength(1);
    expect(gateway.callsOf('sendReactionRolesMessage')).toHaveLength(0);
  });

  it('re-seeds the reaction strip on every edit so new options surface without repost', async () => {
    // First render with one option → bot adds 🇺🇸 reaction.
    await service.addOption(panelId, optionInput());
    await service.renderPanel(panelId);
    gateway.reset();
    // Operator adds a second option, then re-renders (the dashboard
    // option-add Server Action drives this implicitly).
    await service.addOption(
      panelId,
      optionInput({ label: 'Korean', emoji: '🇰🇷', roleId: ROLE_KR, position: 1 }),
    );
    const result = await service.renderPanel(panelId);
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.value.recreated).toBe(false);
    expect(gateway.callsOf('editReactionRolesMessage')).toHaveLength(1);
    // The fix: edit branch must also call syncBotReactions, otherwise
    // the new 🇰🇷 reaction never appears and the operator is forced to
    // repost (which wipes existing user reactions).
    const reactions = gateway.callsOf('syncBotReactions');
    expect(reactions).toHaveLength(1);
    expect((reactions[0]?.args as { desiredEmojis: string[] }).desiredEmojis).toEqual(['🇺🇸', '🇰🇷']);
  });

  it('repostPanel drops the previous message and sends a fresh one', async () => {
    await service.addOption(panelId, optionInput());
    await service.renderPanel(panelId);
    gateway.reset();
    const result = await service.repostPanel(panelId);
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.value.previousMessageId).not.toBe('pending');
    expect(result.value.messageId).not.toBe(result.value.previousMessageId);
    expect(gateway.callsOf('deleteReactionRolesMessage')).toHaveLength(1);
    expect(gateway.callsOf('sendReactionRolesMessage')).toHaveLength(1);
  });

  it('renderPanel works on an empty panel (no reactions to add)', async () => {
    const result = await service.renderPanel(panelId);
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(gateway.callsOf('syncBotReactions')).toHaveLength(0);
  });

  it('cleans orphan bot reactions when an option is removed via re-render', async () => {
    // Two options published, both with bot reactions on the message.
    await service.addOption(panelId, optionInput());
    await service.addOption(
      panelId,
      optionInput({ label: 'Korean', emoji: '🇰🇷', roleId: ROLE_KR, position: 1 }),
    );
    await service.renderPanel(panelId);
    gateway.reset();
    // Operator removes one option, then the dashboard's option-remove
    // action triggers a re-render (same path as add / edit).
    const optionList = await service.getPanel(panelId);
    if (!optionList.ok) throw optionList.error;
    const koreanOption = optionList.value.options.find((o) => o.emoji === '🇰🇷');
    if (koreanOption === undefined) throw new Error('seeded option missing');
    await service.removeOption(koreanOption.id);
    const result = await service.renderPanel(panelId);
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    // The edit-branch sync call now happens unconditionally — even when
    // the new desired set is smaller than before, so the gateway can
    // strip the bot's own 🇰🇷 reaction left over from the deleted option.
    const syncs = gateway.callsOf('syncBotReactions');
    expect(syncs).toHaveLength(1);
    expect((syncs[0]?.args as { desiredEmojis: string[] }).desiredEmojis).toEqual(['🇺🇸']);
  });
});

// ─────────────────────── deletePanel ───────────────────────

describe('ReactionRolesService.deletePanel', () => {
  let testDb: TestDb;
  let gateway: FakeDiscordGateway;
  let service: ReactionRolesService;

  beforeEach(async () => {
    testDb = await createTestDb();
    gateway = new FakeDiscordGateway();
    service = new ReactionRolesService(testDb.db, gateway, branding);
  });
  afterEach(async () => {
    await testDb.close();
  });

  it('removes a published panel and cascades its options + events', async () => {
    const created = await service.createPanel(basePanel);
    if (!created.ok) throw created.error;
    await service.addOption(created.value.panel.id, optionInput());
    await service.renderPanel(created.value.panel.id);
    await service.handleReactionAdd({
      messageId: gateway.callsOf('sendReactionRolesMessage').length > 0 ? 'msg-1' : 'pending',
      emoji: '🇺🇸',
      userId: USER_ID,
      guildId: GUILD_ID,
    });
    const result = await service.deletePanel(created.value.panel.id);
    expect(result.ok).toBe(true);
    expect(await countRows(testDb, schema.reactionRolesPanel)).toBe(0);
    expect(await countRows(testDb, schema.reactionRolesOption)).toBe(0);
    expect(await countRows(testDb, schema.reactionRolesEvent)).toBe(0);
  });

  it('returns NotFoundError when the panel is unknown', async () => {
    const result = await service.deletePanel('nope');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected NotFoundError');
    expect(result.error.code).toBe('NOT_FOUND');
  });
});

// ─────────────────────── handleReactionAdd ───────────────────────

describe('ReactionRolesService.handleReactionAdd', () => {
  let testDb: TestDb;
  let gateway: FakeDiscordGateway;
  let service: ReactionRolesService;
  let panelId: string;
  let messageId: string;

  beforeEach(async () => {
    testDb = await createTestDb();
    gateway = new FakeDiscordGateway();
    service = new ReactionRolesService(testDb.db, gateway, branding);
    const created = await service.createPanel(basePanel);
    if (!created.ok) throw created.error;
    panelId = created.value.panel.id;
    await service.addOption(panelId, optionInput());
    await service.addOption(
      panelId,
      optionInput({ label: 'Korean', emoji: '🇰🇷', roleId: ROLE_KR, position: 1 }),
    );
    const render = await service.renderPanel(panelId);
    if (!render.ok) throw render.error;
    messageId = render.value.messageId;
  });
  afterEach(async () => {
    await testDb.close();
  });

  it('grants the role and audits "granted" on a known emoji', async () => {
    const result = await service.handleReactionAdd({
      messageId,
      emoji: '🇺🇸',
      userId: USER_ID,
      guildId: GUILD_ID,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.value.action).toBe(ReactionRolesAction.granted);
    expect(result.value.roleId).toBe(ROLE_US);
    expect(gateway.callsOf('assignRoleToMember')).toHaveLength(1);
    expect(await countRows(testDb, schema.reactionRolesEvent)).toBe(1);
  });

  it('records each role independently for multi-select users', async () => {
    await service.handleReactionAdd({
      messageId,
      emoji: '🇺🇸',
      userId: USER_ID,
      guildId: GUILD_ID,
    });
    await service.handleReactionAdd({
      messageId,
      emoji: '🇰🇷',
      userId: USER_ID,
      guildId: GUILD_ID,
    });
    expect(gateway.callsOf('assignRoleToMember')).toHaveLength(2);
    expect(await countRows(testDb, schema.reactionRolesEvent)).toBe(2);
  });

  it('noops silently when the messageId does not match any panel', async () => {
    const result = await service.handleReactionAdd({
      messageId: 'unrelated-message',
      emoji: '🇺🇸',
      userId: USER_ID,
      guildId: GUILD_ID,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.value.action).toBe(ReactionRolesAction.noop);
    expect(gateway.callsOf('assignRoleToMember')).toHaveLength(0);
    expect(await countRows(testDb, schema.reactionRolesEvent)).toBe(0);
  });

  it('noops when the emoji is not bound on this panel', async () => {
    const result = await service.handleReactionAdd({
      messageId,
      emoji: '🇯🇵',
      userId: USER_ID,
      guildId: GUILD_ID,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.value.action).toBe(ReactionRolesAction.noop);
    expect(gateway.callsOf('assignRoleToMember')).toHaveLength(0);
    expect(await countRows(testDb, schema.reactionRolesEvent)).toBe(0);
  });

  it('audits "noop" when Discord rejects the role assignment', async () => {
    // Re-wire a gateway that fails the assign with a DiscordApiError.
    const failingGateway = new FakeDiscordGateway({ failAssignAsDiscordError: true });
    const failingService = new ReactionRolesService(testDb.db, failingGateway, branding);
    const result = await failingService.handleReactionAdd({
      messageId,
      emoji: '🇺🇸',
      userId: USER_ID,
      guildId: GUILD_ID,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.value.action).toBe(ReactionRolesAction.noop);
    expect(await countRows(testDb, schema.reactionRolesEvent)).toBe(1);
  });
});

// ─────────────────────── handleReactionRemove ───────────────────────

describe('ReactionRolesService.handleReactionRemove', () => {
  let testDb: TestDb;
  let gateway: FakeDiscordGateway;
  let service: ReactionRolesService;
  let messageId: string;

  beforeEach(async () => {
    testDb = await createTestDb();
    gateway = new FakeDiscordGateway();
    service = new ReactionRolesService(testDb.db, gateway, branding);
    const created = await service.createPanel(basePanel);
    if (!created.ok) throw created.error;
    await service.addOption(created.value.panel.id, optionInput());
    const render = await service.renderPanel(created.value.panel.id);
    if (!render.ok) throw render.error;
    messageId = render.value.messageId;
  });
  afterEach(async () => {
    await testDb.close();
  });

  it('removes the role and audits "revoked" on a known emoji', async () => {
    const result = await service.handleReactionRemove({
      messageId,
      emoji: '🇺🇸',
      userId: USER_ID,
      guildId: GUILD_ID,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.value.action).toBe(ReactionRolesAction.revoked);
    expect(gateway.callsOf('removeRoleFromMember')).toHaveLength(1);
    expect(await countRows(testDb, schema.reactionRolesEvent)).toBe(1);
  });

  it('noops when the messageId does not match', async () => {
    const result = await service.handleReactionRemove({
      messageId: 'unrelated',
      emoji: '🇺🇸',
      userId: USER_ID,
      guildId: GUILD_ID,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.value.action).toBe(ReactionRolesAction.noop);
    expect(gateway.callsOf('removeRoleFromMember')).toHaveLength(0);
  });

  it('audits "noop" when Discord rejects the role removal', async () => {
    const failingGateway = new FakeDiscordGateway({ failRemoveAsDiscordError: true });
    const failingService = new ReactionRolesService(testDb.db, failingGateway, branding);
    const result = await failingService.handleReactionRemove({
      messageId,
      emoji: '🇺🇸',
      userId: USER_ID,
      guildId: GUILD_ID,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.value.action).toBe(ReactionRolesAction.noop);
    expect(await countRows(testDb, schema.reactionRolesEvent)).toBe(1);
  });
});

// ─────────────────────── audit list / count ───────────────────────

describe('ReactionRolesService.listEvents / countEvents', () => {
  let testDb: TestDb;
  let gateway: FakeDiscordGateway;
  let service: ReactionRolesService;
  let panelId: string;
  let messageId: string;

  beforeEach(async () => {
    testDb = await createTestDb();
    gateway = new FakeDiscordGateway();
    service = new ReactionRolesService(testDb.db, gateway, branding);
    const created = await service.createPanel(basePanel);
    if (!created.ok) throw created.error;
    panelId = created.value.panel.id;
    await service.addOption(panelId, optionInput());
    await service.addOption(
      panelId,
      optionInput({ label: 'Japanese', emoji: '🇯🇵', roleId: ROLE_JP, position: 1 }),
    );
    const render = await service.renderPanel(panelId);
    if (!render.ok) throw render.error;
    messageId = render.value.messageId;
    await service.handleReactionAdd({ messageId, emoji: '🇺🇸', userId: USER_ID, guildId: GUILD_ID });
    await service.handleReactionAdd({ messageId, emoji: '🇯🇵', userId: USER_ID, guildId: GUILD_ID });
  });
  afterEach(async () => {
    await testDb.close();
  });

  it('countEvents returns the total event count for the panel', async () => {
    expect(await service.countEvents(panelId)).toBe(2);
  });

  it('listEvents returns events ordered by createdAt', async () => {
    const events = await service.listEvents(panelId);
    expect(events).toHaveLength(2);
    expect(events.every((e) => e.action === ReactionRolesAction.granted)).toBe(true);
  });
});

// ─────────────────────── getOptionHolders SQL aggregation ───────────────────────

describe('ReactionRolesService.getOptionHolders (SQL net-count)', () => {
  let testDb: TestDb;
  let gateway: FakeDiscordGateway;
  let service: ReactionRolesService;
  let panelId: string;
  let messageId: string;
  let usOptionId: string;

  const userOnce = 'u-once';
  const userBalanced = 'u-net-zero';
  const userBouncing = 'u-toggled-back-on';
  const userToggled = 'u-toggled-off';

  beforeEach(async () => {
    testDb = await createTestDb();
    gateway = new FakeDiscordGateway();
    service = new ReactionRolesService(testDb.db, gateway, branding);
    const created = await service.createPanel(basePanel);
    if (!created.ok) throw created.error;
    panelId = created.value.panel.id;
    const us = await service.addOption(panelId, optionInput());
    if (!us.ok) throw us.error;
    usOptionId = us.value.id;
    const render = await service.renderPanel(panelId);
    if (!render.ok) throw render.error;
    messageId = render.value.messageId;
  });
  afterEach(async () => {
    await testDb.close();
  });

  it('returns empty list when no events exist', async () => {
    expect(await service.getOptionHolders(usOptionId)).toEqual([]);
  });

  it('includes a user with a single grant (net +1)', async () => {
    await service.handleReactionAdd({
      messageId,
      emoji: '🇺🇸',
      userId: userOnce,
      guildId: GUILD_ID,
    });
    expect(await service.getOptionHolders(usOptionId)).toEqual([userOnce]);
  });

  it('excludes a user whose grant + revoke nets to zero', async () => {
    await service.handleReactionAdd({
      messageId,
      emoji: '🇺🇸',
      userId: userBalanced,
      guildId: GUILD_ID,
    });
    await service.handleReactionRemove({
      messageId,
      emoji: '🇺🇸',
      userId: userBalanced,
      guildId: GUILD_ID,
    });
    expect(await service.getOptionHolders(usOptionId)).toEqual([]);
  });

  it('includes a user whose grant + revoke + grant nets to +1', async () => {
    for (let i = 0; i < 2; i++) {
      await service.handleReactionAdd({
        messageId,
        emoji: '🇺🇸',
        userId: userBouncing,
        guildId: GUILD_ID,
      });
      if (i === 0) {
        await service.handleReactionRemove({
          messageId,
          emoji: '🇺🇸',
          userId: userBouncing,
          guildId: GUILD_ID,
        });
      }
    }
    expect(await service.getOptionHolders(usOptionId)).toEqual([userBouncing]);
  });

  it('handles a mix of users with different patterns in one call', async () => {
    // userOnce: grant → holder
    await service.handleReactionAdd({
      messageId,
      emoji: '🇺🇸',
      userId: userOnce,
      guildId: GUILD_ID,
    });
    // userToggled: grant → revoke → NOT a holder
    await service.handleReactionAdd({
      messageId,
      emoji: '🇺🇸',
      userId: userToggled,
      guildId: GUILD_ID,
    });
    await service.handleReactionRemove({
      messageId,
      emoji: '🇺🇸',
      userId: userToggled,
      guildId: GUILD_ID,
    });
    // userBouncing: grant → revoke → grant → holder
    await service.handleReactionAdd({
      messageId,
      emoji: '🇺🇸',
      userId: userBouncing,
      guildId: GUILD_ID,
    });
    await service.handleReactionRemove({
      messageId,
      emoji: '🇺🇸',
      userId: userBouncing,
      guildId: GUILD_ID,
    });
    await service.handleReactionAdd({
      messageId,
      emoji: '🇺🇸',
      userId: userBouncing,
      guildId: GUILD_ID,
    });

    const holders = await service.getOptionHolders(usOptionId);
    expect(new Set(holders)).toEqual(new Set([userOnce, userBouncing]));
    expect(holders).not.toContain(userToggled);
  });

  it("noop events don't affect the net count", async () => {
    // Grant gives net +1, then a manually-injected noop event (which
    // models a Discord-rejected role op) should leave the net at +1.
    await service.handleReactionAdd({
      messageId,
      emoji: '🇺🇸',
      userId: userOnce,
      guildId: GUILD_ID,
    });
    await testDb.db.insert(schema.reactionRolesEvent).values({
      panelId,
      userId: userOnce,
      optionId: usOptionId,
      action: ReactionRolesAction.noop,
    });
    expect(await service.getOptionHolders(usOptionId)).toEqual([userOnce]);
  });
});

// ─────────────── audit retention across option delete ───────────────

describe('ReactionRolesService — audit retention across option delete', () => {
  let testDb: TestDb;
  let gateway: FakeDiscordGateway;
  let service: ReactionRolesService;
  let panelId: string;
  let messageId: string;
  let usOptionId: string;

  beforeEach(async () => {
    testDb = await createTestDb();
    gateway = new FakeDiscordGateway();
    service = new ReactionRolesService(testDb.db, gateway, branding);
    const created = await service.createPanel(basePanel);
    if (!created.ok) throw created.error;
    panelId = created.value.panel.id;
    const us = await service.addOption(panelId, optionInput());
    if (!us.ok) throw us.error;
    usOptionId = us.value.id;
    const render = await service.renderPanel(panelId);
    if (!render.ok) throw render.error;
    messageId = render.value.messageId;
  });
  afterEach(async () => {
    await testDb.close();
  });

  it('snapshots option label/emoji/roleId onto every audit row', async () => {
    await service.handleReactionAdd({
      messageId,
      emoji: '🇺🇸',
      userId: USER_ID,
      guildId: GUILD_ID,
    });
    const events = await testDb.db
      .select()
      .from(schema.reactionRolesEvent)
      .where(eq(schema.reactionRolesEvent.panelId, panelId));
    expect(events).toHaveLength(1);
    expect(events[0]?.optionLabel).toBe('English');
    expect(events[0]?.optionEmoji).toBe('🇺🇸');
    expect(events[0]?.optionRoleId).toBe(ROLE_US);
    expect(events[0]?.optionId).toBe(usOptionId);
  });

  it('preserves audit rows on option delete via ON DELETE SET NULL', async () => {
    await service.handleReactionAdd({
      messageId,
      emoji: '🇺🇸',
      userId: USER_ID,
      guildId: GUILD_ID,
    });
    await service.removeOption(usOptionId);

    // Audit row survives — only optionId goes to NULL. Snapshot
    // columns (label, emoji, roleId) remain populated, so historical
    // queries can still answer "what role did this user react for
    // on 2026-05-11?"
    const events = await testDb.db
      .select()
      .from(schema.reactionRolesEvent)
      .where(eq(schema.reactionRolesEvent.panelId, panelId));
    expect(events).toHaveLength(1);
    expect(events[0]?.optionId).toBeNull();
    expect(events[0]?.optionLabel).toBe('English');
    expect(events[0]?.optionEmoji).toBe('🇺🇸');
    expect(events[0]?.optionRoleId).toBe(ROLE_US);
    expect(events[0]?.action).toBe(ReactionRolesAction.granted);
  });

  it('still cascades audit rows on panel delete (panel is the retention boundary)', async () => {
    await service.handleReactionAdd({
      messageId,
      emoji: '🇺🇸',
      userId: USER_ID,
      guildId: GUILD_ID,
    });
    await service.deletePanel(panelId);
    const events = await testDb.db
      .select()
      .from(schema.reactionRolesEvent)
      .where(eq(schema.reactionRolesEvent.panelId, panelId));
    expect(events).toHaveLength(0);
  });
});
