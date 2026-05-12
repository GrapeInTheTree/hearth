import { schema, ReactionRolesAction } from '@hearth/database';
import { ReactionRolesService } from '@hearth/reaction-roles-core';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FakeDiscordGateway } from '../../../../packages/reaction-roles-core/tests/helpers/fakeGateway.js';
import { branding } from '../../src/config/branding.js';
import { type IntegrationDb, startIntegrationDb } from '../helpers/testDb.js';

const SHOULD_RUN = process.env['RUN_INTEGRATION'] === '1';

const GUILD_ID = 'g-reactionroles-int';
const CHANNEL_ID = 'c-reactionroles-int';
const ROLE_US = 'r-en-int';
const ROLE_KR = 'r-ko-int';
const USER_A = 'u-reactionroles-A';
const USER_B = 'u-reactionroles-B';

describe.runIf(SHOULD_RUN)('integration: reaction-roles lifecycle (real Postgres)', () => {
  let env: IntegrationDb;
  let gateway: FakeDiscordGateway;
  let service: ReactionRolesService;
  let panelId: string;
  let messageId: string;

  beforeAll(async () => {
    env = await startIntegrationDb();
    gateway = new FakeDiscordGateway();
    service = new ReactionRolesService(env.db, gateway, branding);

    const created = await service.createPanel({
      guildId: GUILD_ID,
      channelId: CHANNEL_ID,
      embedTitle: 'Languages',
      embedDescription: 'Pick the flags you read.',
    });
    if (!created.ok) throw created.error;
    panelId = created.value.panel.id;

    const us = await service.addOption(panelId, {
      label: 'English',
      emoji: '🇺🇸',
      roleId: ROLE_US,
      position: 0,
    });
    if (!us.ok) throw us.error;
    const kr = await service.addOption(panelId, {
      label: 'Korean',
      emoji: '🇰🇷',
      roleId: ROLE_KR,
      position: 1,
    });
    if (!kr.ok) throw kr.error;

    const rendered = await service.renderPanel(panelId);
    if (!rendered.ok) throw rendered.error;
    messageId = rendered.value.messageId;
    gateway.reset();
  });

  afterAll(async () => {
    await env.close();
  });

  it('grants and revokes roles as users add/remove reactions, multi-select per user', async () => {
    // User A adds 🇺🇸
    const grantA = await service.handleReactionAdd({
      messageId,
      emoji: '🇺🇸',
      userId: USER_A,
      guildId: GUILD_ID,
    });
    if (!grantA.ok) return;
    expect(grantA.value.action).toBe(ReactionRolesAction.granted);
    expect(grantA.value.roleId).toBe(ROLE_US);

    // User A adds 🇰🇷 (multi-select — both roles)
    const grantAKr = await service.handleReactionAdd({
      messageId,
      emoji: '🇰🇷',
      userId: USER_A,
      guildId: GUILD_ID,
    });
    if (!grantAKr.ok) return;
    expect(grantAKr.value.action).toBe(ReactionRolesAction.granted);

    // User B independently adds 🇺🇸 — fresh grant
    const grantB = await service.handleReactionAdd({
      messageId,
      emoji: '🇺🇸',
      userId: USER_B,
      guildId: GUILD_ID,
    });
    if (!grantB.ok) return;
    expect(grantB.value.action).toBe(ReactionRolesAction.granted);
    expect(gateway.callsOf('assignRoleToMember')).toHaveLength(3);

    // User A removes 🇺🇸 — revoke
    const revokeA = await service.handleReactionRemove({
      messageId,
      emoji: '🇺🇸',
      userId: USER_A,
      guildId: GUILD_ID,
    });
    if (!revokeA.ok) return;
    expect(revokeA.value.action).toBe(ReactionRolesAction.revoked);
    expect(gateway.callsOf('removeRoleFromMember')).toHaveLength(1);

    // Reaction on an emoji not bound to the panel → noop, no DB row.
    const beforeNoopEvents = await env.db
      .select()
      .from(schema.reactionRolesEvent)
      .where(eq(schema.reactionRolesEvent.panelId, panelId));
    const unrelated = await service.handleReactionAdd({
      messageId,
      emoji: '🇯🇵',
      userId: USER_A,
      guildId: GUILD_ID,
    });
    if (!unrelated.ok) return;
    expect(unrelated.value.action).toBe(ReactionRolesAction.noop);
    const afterNoopEvents = await env.db
      .select()
      .from(schema.reactionRolesEvent)
      .where(eq(schema.reactionRolesEvent.panelId, panelId));
    expect(afterNoopEvents.length).toBe(beforeNoopEvents.length);

    // Audit log must contain: granted (US, A), granted (KR, A), granted (US, B), revoked (US, A).
    const events = await env.db
      .select()
      .from(schema.reactionRolesEvent)
      .where(eq(schema.reactionRolesEvent.panelId, panelId))
      .orderBy(schema.reactionRolesEvent.createdAt);
    expect(events.map((e) => e.action)).toEqual([
      ReactionRolesAction.granted,
      ReactionRolesAction.granted,
      ReactionRolesAction.granted,
      ReactionRolesAction.revoked,
    ]);
  });

  it('deletePanel cascades to options and events', async () => {
    const before = await env.db
      .select()
      .from(schema.reactionRolesOption)
      .where(eq(schema.reactionRolesOption.panelId, panelId));
    expect(before.length).toBeGreaterThan(0);

    const result = await service.deletePanel(panelId);
    expect(result.ok).toBe(true);

    const orphanOptions = await env.db
      .select()
      .from(schema.reactionRolesOption)
      .where(eq(schema.reactionRolesOption.panelId, panelId));
    expect(orphanOptions).toHaveLength(0);

    const orphanEvents = await env.db
      .select()
      .from(schema.reactionRolesEvent)
      .where(eq(schema.reactionRolesEvent.panelId, panelId));
    expect(orphanEvents).toHaveLength(0);
  });
});
