import { schema, VerificationOutcome } from '@hearth/database';
import { VerificationService } from '@hearth/verification-core';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FakeDiscordGateway } from '../../../../packages/verification-core/tests/helpers/fakeGateway.js';
import { branding } from '../../src/config/branding.js';
import { type IntegrationDb, startIntegrationDb } from '../helpers/testDb.js';

const SHOULD_RUN = process.env['RUN_INTEGRATION'] === '1';

const GUILD_ID = 'g-verification-int';
const CHANNEL_ID = 'c-verification-int';
const ROLE_ID = 'r-verification-int';
const USER_A = 'u-verification-A';
const USER_B = 'u-verification-B';

describe.runIf(SHOULD_RUN)('integration: verification lifecycle (real Postgres)', () => {
  let env: IntegrationDb;
  let gateway: FakeDiscordGateway;
  let service: VerificationService;
  let panelId: string;
  let correctOptionId: string;
  let wrongOptionId: string;

  beforeAll(async () => {
    env = await startIntegrationDb();
    gateway = new FakeDiscordGateway();
    service = new VerificationService(env.db, gateway, branding);

    const created = await service.createPanel({
      guildId: GUILD_ID,
      channelId: CHANNEL_ID,
      roleId: ROLE_ID,
      embedTitle: 'Verify',
      embedDescription: 'Click the right one.',
    });
    if (!created.ok) throw created.error;
    panelId = created.value.panel.id;

    const correct = await service.addOption(panelId, {
      label: '🍇 Grape',
      emoji: '🍇',
      buttonStyle: 'success',
      position: 0,
    });
    if (!correct.ok) throw correct.error;
    correctOptionId = correct.value.id;

    const wrong = await service.addOption(panelId, {
      label: '🍎 Apple',
      emoji: '🍎',
      buttonStyle: 'secondary',
      position: 1,
    });
    if (!wrong.ok) throw wrong.error;
    wrongOptionId = wrong.value.id;

    const setCorrect = await service.setCorrectOption(panelId, correctOptionId);
    if (!setCorrect.ok) throw setCorrect.error;

    const rendered = await service.renderPanel(panelId);
    if (!rendered.ok) throw rendered.error;
    gateway.reset();
  });

  afterAll(async () => {
    await env.close();
  });

  it('happy path: correct click grants role, wrong click does not, re-click is idempotent', async () => {
    const wrongResult = await service.handleSubmission({
      panelId,
      optionId: wrongOptionId,
      userId: USER_A,
    });
    expect(wrongResult.ok).toBe(true);
    if (!wrongResult.ok) return;
    expect(wrongResult.value.outcome).toBe(VerificationOutcome.wrongAnswer);

    const correctResult = await service.handleSubmission({
      panelId,
      optionId: correctOptionId,
      userId: USER_A,
    });
    if (!correctResult.ok) return;
    expect(correctResult.value.outcome).toBe(VerificationOutcome.success);
    expect(gateway.callsOf('assignRoleToMember')).toHaveLength(1);

    const reclickResult = await service.handleSubmission({
      panelId,
      optionId: correctOptionId,
      userId: USER_A,
    });
    if (!reclickResult.ok) return;
    expect(reclickResult.value.outcome).toBe(VerificationOutcome.alreadyVerified);
    // Crucially the second click MUST NOT trigger another assignRoleToMember.
    expect(gateway.callsOf('assignRoleToMember')).toHaveLength(1);

    // Different user; their first click is still a fresh success.
    const otherUser = await service.handleSubmission({
      panelId,
      optionId: correctOptionId,
      userId: USER_B,
    });
    if (!otherUser.ok) return;
    expect(otherUser.value.outcome).toBe(VerificationOutcome.success);
    expect(gateway.callsOf('assignRoleToMember')).toHaveLength(2);

    // Audit log must contain four rows in order: wrong, success, already, success.
    const events = await env.db
      .select()
      .from(schema.verificationEvent)
      .where(eq(schema.verificationEvent.panelId, panelId))
      .orderBy(schema.verificationEvent.createdAt);
    expect(events.map((e) => e.outcome)).toEqual([
      VerificationOutcome.wrongAnswer,
      VerificationOutcome.success,
      VerificationOutcome.alreadyVerified,
      VerificationOutcome.success,
    ]);
  });

  it('deletePanel cascades to options and events', async () => {
    const before = await env.db
      .select()
      .from(schema.verificationOption)
      .where(eq(schema.verificationOption.panelId, panelId));
    expect(before.length).toBeGreaterThan(0);

    const result = await service.deletePanel(panelId);
    expect(result.ok).toBe(true);

    const orphanOptions = await env.db
      .select()
      .from(schema.verificationOption)
      .where(eq(schema.verificationOption.panelId, panelId));
    expect(orphanOptions).toHaveLength(0);

    const orphanEvents = await env.db
      .select()
      .from(schema.verificationEvent)
      .where(eq(schema.verificationEvent.panelId, panelId));
    expect(orphanEvents).toHaveLength(0);
  });
});
