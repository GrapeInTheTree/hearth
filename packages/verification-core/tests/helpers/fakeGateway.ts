import { DiscordApiError } from '@hearth/shared';
import type {
  CreateTicketChannelInput,
  DiscordGateway,
  ModlogEmbed,
  PanelMessagePayload,
  SendWelcomeMessageInput,
  VerificationMessagePayload,
} from '@hearth/tickets-core';

// In-memory DiscordGateway double — mirrors the helper in
// @hearth/tickets-core/tests but exposed here so verification-core's unit
// tests can import without crossing package private/test boundaries.
// Records every call so assertions can verify side-effect order, and
// honours an optional `throwOn` set + a `failRoleAssignWithDiscordError`
// flag for the role-assign failure path.

// Loose shape — verification doesn't drive welcome messages, but the port
// requires the type, so we relay through Record<string, unknown> to avoid
// pulling welcomeBuilder types into this fake.
type WelcomeMessagePayloadShape = Record<string, unknown>;

export interface FakeGatewayCall {
  readonly op: string;
  readonly args: unknown;
}

export interface FakeGatewayOptions {
  readonly nextChannelId?: () => string;
  readonly nextMessageId?: () => string;
  readonly throwOn?: ReadonlySet<string>;
  /** Member→role membership snapshot. Key: `<guildId>:<userId>:<roleId>`. */
  readonly memberRoles?: ReadonlySet<string>;
  /** When true, assignRoleToMember rejects with a DiscordApiError simulating
   *  a 50013 (Missing Permissions) so the service maps to 'role_assign_failed'. */
  readonly failRoleAssignAsDiscordError?: boolean;
}

export class FakeDiscordGateway implements DiscordGateway {
  public readonly calls: FakeGatewayCall[] = [];
  private channelCounter = 0;
  private messageCounter = 0;
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
    payload: WelcomeMessagePayloadShape,
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
    return Promise.resolve(0);
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
    if (this.options.failRoleAssignAsDiscordError === true) {
      return Promise.reject(new DiscordApiError('Missing Permissions (50013)', 403, undefined));
    }
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

  public callsOf(op: string): FakeGatewayCall[] {
    return this.calls.filter((c) => c.op === op);
  }

  public reset(): void {
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
