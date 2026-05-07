import type { APIEmbed } from 'discord-api-types/v10';

import type { WelcomeMessagePayload } from '../lib/welcomeBuilder.js';

// The DiscordGateway interface is the only seam through which services
// touch Discord. Production wiring uses DjsDiscordGateway (in apps/bot)
// which delegates to a SapphireClient. Tests inject a FakeDiscordGateway.
//
// Hard rule: services NEVER import from 'discord.js' directly. Anything
// the service needs from Discord goes through this interface, with raw
// IDs and plain JSON shapes (discord-api-types) only. Anything richer
// than `string` / `number` / `bigint` / `readonly Record<...>` is
// suspicious. This is what makes services unit-testable without booting
// the framework, and what lets @hearth/tickets-core stay free of
// the discord.js runtime so it can be imported by the dashboard.

export interface PanelMessagePayload {
  readonly content: string | undefined;
  readonly embeds: readonly APIEmbed[];
  readonly components: readonly unknown[];
}

// Verification messages share the same shape as panels (embed + button row)
// — keeping them as a distinct type makes intent obvious at call sites and
// leaves room to diverge later (e.g. ephemeral hint embeds for verification
// only) without rippling through panel code.
export interface VerificationMessagePayload {
  readonly content: string | undefined;
  readonly embeds: readonly APIEmbed[];
  readonly components: readonly unknown[];
}

export interface ModlogEmbed {
  readonly title: string;
  readonly fields: readonly {
    readonly name: string;
    readonly value: string;
    readonly inline?: boolean;
  }[];
  readonly color?: number;
  readonly timestamp?: string;
}

export interface CreateTicketChannelInput {
  readonly guildId: string;
  readonly parentId: string;
  readonly name: string;
  readonly topic: string;
  readonly openerId: string;
  readonly supportRoleIds: readonly string[];
}

export interface SendWelcomeMessageInput {
  readonly channelId: string;
  readonly payload: WelcomeMessagePayload;
  readonly pingRoleIds: readonly string[];
  readonly pin: boolean;
}

export interface DiscordGateway {
  /** Create a private text channel for a ticket. Returns the new channel id. */
  createTicketChannel(input: CreateTicketChannelInput): Promise<{ channelId: string }>;

  /** Post the welcome embed (with buttons) to the ticket channel. Pins it if requested. */
  sendWelcomeMessage(input: SendWelcomeMessageInput): Promise<{ messageId: string }>;

  /** Edit an existing welcome message — used to swap button states on claim/close/reopen. */
  editWelcomeMessage(
    channelId: string,
    messageId: string,
    payload: WelcomeMessagePayload,
  ): Promise<void>;

  /** Plain non-embed content message (used for "{user} closed the ticket." system lines). */
  postSystemMessage(channelId: string, content: string): Promise<void>;

  /** Move a channel to a different category (open ↔ archive). */
  moveChannelToCategory(channelId: string, categoryId: string): Promise<void>;

  /** Toggle the opener's SEND_MESSAGES override on the ticket channel. */
  setOpenerSendMessages(channelId: string, openerId: string, allow: boolean): Promise<void>;

  /** Count children of a category — for the 48-soft-cap overflow guard. */
  countCategoryChildren(categoryId: string): Promise<number>;

  /** Hard-delete a channel. */
  deleteChannel(channelId: string, reason: string): Promise<void>;

  /** Post a modlog summary embed for a deleted ticket. */
  postModlogSummary(logChannelId: string, embed: ModlogEmbed): Promise<void>;

  /** Send a panel message to a public channel. */
  sendPanelMessage(channelId: string, payload: PanelMessagePayload): Promise<{ messageId: string }>;

  /** Edit an existing panel message (idempotent /panel create). */
  editPanelMessage(
    channelId: string,
    messageId: string,
    payload: PanelMessagePayload,
  ): Promise<void>;

  /** Hard-delete a panel message. Used by the "Repost panel" flow to
   *  drop the existing message before sending a fresh one further down
   *  the channel. Best-effort — silently swallows already-gone messages
   *  so the caller doesn't have to branch on 404. */
  deletePanelMessage(channelId: string, messageId: string): Promise<void>;

  /** Resolve a member's display name for system messages. Returns id-string fallback if not cached. */
  resolveMemberDisplay(guildId: string, userId: string): Promise<string>;

  // ─── Verification (DEFI-658) ──────────────────────────────────────────
  // Same lifecycle shape as panel messages but kept as separate methods
  // so the bot's djs gateway can log/observe verification activity
  // distinctly and so future verification-only behaviour (e.g. hint
  // embeds, ephemeral confirmations) can be added without touching panels.

  /** Send a verification message to a public channel. */
  sendVerificationMessage(
    channelId: string,
    payload: VerificationMessagePayload,
  ): Promise<{ messageId: string }>;

  /** Edit an existing verification message — used after option add/edit/remove. */
  editVerificationMessage(
    channelId: string,
    messageId: string,
    payload: VerificationMessagePayload,
  ): Promise<void>;

  /** Hard-delete a verification message. Best-effort — silently swallows
   *  already-gone messages so the caller doesn't have to branch on 404. */
  deleteVerificationMessage(channelId: string, messageId: string): Promise<void>;

  /** Grant a role to a guild member. Throws DiscordApiError on Manage Roles
   *  missing, role hierarchy violation, or member fetch failure — the
   *  service layer catches and maps to a 'role_assign_failed' outcome. */
  assignRoleToMember(guildId: string, userId: string, roleId: string): Promise<void>;

  /** Test whether a guild member already holds a role. Used to short-circuit
   *  re-clicks of a correct verification button into an "already verified"
   *  outcome rather than a redundant Discord write. */
  memberHasRole(guildId: string, userId: string, roleId: string): Promise<boolean>;
}
