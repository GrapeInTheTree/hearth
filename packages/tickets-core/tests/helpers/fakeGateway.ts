import type { WelcomeMessagePayload } from '../../src/lib/welcomeBuilder.js';
import type {
  CreateTicketChannelInput,
  DiscordGateway,
  ModlogEmbed,
  PanelMessagePayload,
  SelfRolesMessagePayload,
  SendWelcomeMessageInput,
  VerificationMessagePayload,
} from '../../src/ports/discordGateway.js';

export interface FakeGatewayCall {
  readonly op: string;
  readonly args: unknown;
}

export interface FakeGatewayOptions {
  readonly channelChildren?: number;
  readonly nextChannelId?: () => string;
  readonly nextMessageId?: () => string;
  readonly throwOn?: ReadonlySet<string>;
  /** Member→role membership snapshot used by `memberHasRole`. Key format:
   *  `<guildId>:<userId>:<roleId>`. Defaults to "no membership". */
  readonly memberRoles?: ReadonlySet<string>;
}

/**
 * In-memory DiscordGateway double for unit tests. Records every call so
 * assertions can verify that services drive Discord side effects in the
 * right order with the right arguments.
 */
export class FakeDiscordGateway implements DiscordGateway {
  public readonly calls: FakeGatewayCall[] = [];
  private channelCounter = 0;
  private messageCounter = 0;
  // Tracks roles granted via assignRoleToMember during this fake's lifetime.
  // Combined with the seed in `options.memberRoles` to answer memberHasRole.
  private readonly grantedRoles = new Set<string>();

  public constructor(private readonly options: FakeGatewayOptions = {}) {}

  public async createTicketChannel(
    input: CreateTicketChannelInput,
  ): Promise<{ channelId: string }> {
    this.record('createTicketChannel', input);
    this.maybeThrow('createTicketChannel');
    const channelId = this.options.nextChannelId?.() ?? `chan-${String(++this.channelCounter)}`;
    return Promise.resolve({ channelId });
  }

  public async sendWelcomeMessage(input: SendWelcomeMessageInput): Promise<{ messageId: string }> {
    this.record('sendWelcomeMessage', input);
    this.maybeThrow('sendWelcomeMessage');
    const messageId = this.options.nextMessageId?.() ?? `msg-${String(++this.messageCounter)}`;
    return Promise.resolve({ messageId });
  }

  public editWelcomeMessage(
    channelId: string,
    messageId: string,
    payload: WelcomeMessagePayload,
  ): Promise<void> {
    this.record('editWelcomeMessage', { channelId, messageId, payload });
    this.maybeThrow('editWelcomeMessage');
    return Promise.resolve();
  }

  public postSystemMessage(channelId: string, content: string): Promise<void> {
    this.record('postSystemMessage', { channelId, content });
    this.maybeThrow('postSystemMessage');
    return Promise.resolve();
  }

  public moveChannelToCategory(channelId: string, categoryId: string): Promise<void> {
    this.record('moveChannelToCategory', { channelId, categoryId });
    this.maybeThrow('moveChannelToCategory');
    return Promise.resolve();
  }

  public setOpenerSendMessages(channelId: string, openerId: string, allow: boolean): Promise<void> {
    this.record('setOpenerSendMessages', { channelId, openerId, allow });
    this.maybeThrow('setOpenerSendMessages');
    return Promise.resolve();
  }

  public countCategoryChildren(categoryId: string): Promise<number> {
    this.record('countCategoryChildren', { categoryId });
    this.maybeThrow('countCategoryChildren');
    return Promise.resolve(this.options.channelChildren ?? 0);
  }

  public deleteChannel(channelId: string, reason: string): Promise<void> {
    this.record('deleteChannel', { channelId, reason });
    this.maybeThrow('deleteChannel');
    return Promise.resolve();
  }

  public postModlogSummary(logChannelId: string, embed: ModlogEmbed): Promise<void> {
    this.record('postModlogSummary', { logChannelId, embed });
    this.maybeThrow('postModlogSummary');
    return Promise.resolve();
  }

  public async sendPanelMessage(
    channelId: string,
    payload: PanelMessagePayload,
  ): Promise<{ messageId: string }> {
    this.record('sendPanelMessage', { channelId, payload });
    this.maybeThrow('sendPanelMessage');
    const messageId = this.options.nextMessageId?.() ?? `msg-${String(++this.messageCounter)}`;
    return Promise.resolve({ messageId });
  }

  public editPanelMessage(
    channelId: string,
    messageId: string,
    payload: PanelMessagePayload,
  ): Promise<void> {
    this.record('editPanelMessage', { channelId, messageId, payload });
    this.maybeThrow('editPanelMessage');
    return Promise.resolve();
  }

  public deletePanelMessage(channelId: string, messageId: string): Promise<void> {
    this.record('deletePanelMessage', { channelId, messageId });
    this.maybeThrow('deletePanelMessage');
    return Promise.resolve();
  }

  public resolveMemberDisplay(guildId: string, userId: string): Promise<string> {
    this.record('resolveMemberDisplay', { guildId, userId });
    this.maybeThrow('resolveMemberDisplay');
    return Promise.resolve(`Display(${userId})`);
  }

  public async sendVerificationMessage(
    channelId: string,
    payload: VerificationMessagePayload,
  ): Promise<{ messageId: string }> {
    this.record('sendVerificationMessage', { channelId, payload });
    this.maybeThrow('sendVerificationMessage');
    const messageId = this.options.nextMessageId?.() ?? `msg-${String(++this.messageCounter)}`;
    return Promise.resolve({ messageId });
  }

  public editVerificationMessage(
    channelId: string,
    messageId: string,
    payload: VerificationMessagePayload,
  ): Promise<void> {
    this.record('editVerificationMessage', { channelId, messageId, payload });
    this.maybeThrow('editVerificationMessage');
    return Promise.resolve();
  }

  public deleteVerificationMessage(channelId: string, messageId: string): Promise<void> {
    this.record('deleteVerificationMessage', { channelId, messageId });
    this.maybeThrow('deleteVerificationMessage');
    return Promise.resolve();
  }

  public assignRoleToMember(guildId: string, userId: string, roleId: string): Promise<void> {
    this.record('assignRoleToMember', { guildId, userId, roleId });
    this.maybeThrow('assignRoleToMember');
    // Reflect the assignment in the membership snapshot so subsequent
    // memberHasRole calls observe the new state. Treats the seeded set as
    // mutable for tests that need to replay verification flows.
    this.grantedRoles.add(membershipKey(guildId, userId, roleId));
    return Promise.resolve();
  }

  public memberHasRole(guildId: string, userId: string, roleId: string): Promise<boolean> {
    this.record('memberHasRole', { guildId, userId, roleId });
    this.maybeThrow('memberHasRole');
    const key = membershipKey(guildId, userId, roleId);
    const seeded = this.options.memberRoles?.has(key) === true;
    return Promise.resolve(seeded || this.grantedRoles.has(key));
  }

  public async sendSelfRolesMessage(
    channelId: string,
    payload: SelfRolesMessagePayload,
  ): Promise<{ messageId: string }> {
    this.record('sendSelfRolesMessage', { channelId, payload });
    this.maybeThrow('sendSelfRolesMessage');
    const messageId = this.options.nextMessageId?.() ?? `msg-${String(++this.messageCounter)}`;
    return Promise.resolve({ messageId });
  }

  public editSelfRolesMessage(
    channelId: string,
    messageId: string,
    payload: SelfRolesMessagePayload,
  ): Promise<void> {
    this.record('editSelfRolesMessage', { channelId, messageId, payload });
    this.maybeThrow('editSelfRolesMessage');
    return Promise.resolve();
  }

  public deleteSelfRolesMessage(channelId: string, messageId: string): Promise<void> {
    this.record('deleteSelfRolesMessage', { channelId, messageId });
    this.maybeThrow('deleteSelfRolesMessage');
    return Promise.resolve();
  }

  public syncBotReactions(
    channelId: string,
    messageId: string,
    desiredEmojis: readonly string[],
  ): Promise<void> {
    this.record('syncBotReactions', { channelId, messageId, desiredEmojis });
    this.maybeThrow('syncBotReactions');
    return Promise.resolve();
  }

  public removeRoleFromMember(guildId: string, userId: string, roleId: string): Promise<void> {
    this.record('removeRoleFromMember', { guildId, userId, roleId });
    this.maybeThrow('removeRoleFromMember');
    this.grantedRoles.delete(membershipKey(guildId, userId, roleId));
    return Promise.resolve();
  }

  public callsOf(op: string): FakeGatewayCall[] {
    return this.calls.filter((c) => c.op === op);
  }

  public reset(): void {
    // Only clear call history. The channel/message counters keep
    // climbing monotonically so cross-test channelId/messageId
    // collisions can't happen — the integration tests share a single
    // DB across cases and would otherwise hit Ticket_channelId_key
    // when reset wound the counter back to 1.
    this.calls.length = 0;
  }

  private record(op: string, args: unknown): void {
    this.calls.push({ op, args });
  }

  private maybeThrow(op: string): void {
    if (this.options.throwOn?.has(op) === true) {
      throw new Error(`FakeGateway: ${op} configured to throw`);
    }
  }
}

function membershipKey(guildId: string, userId: string, roleId: string): string {
  return `${guildId}:${userId}:${roleId}`;
}
