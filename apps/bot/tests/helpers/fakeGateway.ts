import type { WelcomeMessagePayload } from '../../src/lib/welcomeBuilder.js';
import type {
  CreateTicketChannelInput,
  DiscordGateway,
  ModlogEmbed,
  PanelMessagePayload,
  SendWelcomeMessageInput,
} from '../../src/services/ports/discordGateway.js';

export interface FakeGatewayCall {
  readonly op: string;
  readonly args: unknown;
}

export interface FakeGatewayOptions {
  readonly channelChildren?: number;
  readonly nextChannelId?: () => string;
  readonly nextMessageId?: () => string;
  readonly throwOn?: ReadonlySet<string>;
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

  public resolveMemberDisplay(guildId: string, userId: string): Promise<string> {
    this.record('resolveMemberDisplay', { guildId, userId });
    this.maybeThrow('resolveMemberDisplay');
    return Promise.resolve(`Display(${userId})`);
  }

  public callsOf(op: string): FakeGatewayCall[] {
    return this.calls.filter((c) => c.op === op);
  }

  public reset(): void {
    this.calls.length = 0;
    this.channelCounter = 0;
    this.messageCounter = 0;
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
