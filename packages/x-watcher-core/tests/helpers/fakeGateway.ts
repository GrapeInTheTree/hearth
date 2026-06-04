import { DiscordApiError } from '@hearth/shared';
import type { XWatcherGateway } from '@hearth/tickets-core';

// Narrow gateway double — implements just XWatcherGateway (BaseGateway +
// sendChannelMessage). The poller only ever calls sendChannelMessage; the
// inherited base role/member ops are stubbed for interface completeness.
// Records every sent message so tests can assert the exact bare links
// posted, in order.

export interface FakeXWatcherGatewayOptions {
  /** When true, sendChannelMessage rejects with a DiscordApiError so the
   *  poller maps the post to a `send_failed` ledger row. */
  readonly failSend?: boolean;
  readonly nextMessageId?: () => string;
}

export interface SentMessage {
  readonly channelId: string;
  readonly content: string;
}

export class FakeXWatcherGateway implements XWatcherGateway {
  public readonly sent: SentMessage[] = [];
  private messageCounter = 0;

  public constructor(private readonly options: FakeXWatcherGatewayOptions = {}) {}

  public sendChannelMessage(channelId: string, content: string): Promise<{ messageId: string }> {
    if (this.options.failSend === true) {
      return Promise.reject(new DiscordApiError('Missing Access (50001)', 403, undefined));
    }
    this.sent.push({ channelId, content });
    const messageId = this.options.nextMessageId?.() ?? `msg-${String(++this.messageCounter)}`;
    return Promise.resolve({ messageId });
  }

  // ─── BaseGateway (unused by the poller; stubbed) ──────────────────

  public assignRoleToMember(): Promise<void> {
    return Promise.resolve();
  }

  public memberHasRole(): Promise<boolean> {
    return Promise.resolve(false);
  }

  public removeRoleFromMember(): Promise<void> {
    return Promise.resolve();
  }

  public resolveMemberDisplay(_guildId: string, userId: string): Promise<string> {
    return Promise.resolve(`Display(${userId})`);
  }
}
