import type { APIEmbed } from 'discord-api-types/v10';

import type { WelcomeMessagePayload } from '../lib/welcomeBuilder.js';

// The DiscordGateway is the only seam through which services touch
// Discord. It is composed from one shared sub-interface (BaseGateway,
// for role + member ops every domain needs) and four domain
// sub-interfaces — TicketsGateway, VerificationGateway, ReactionRolesGateway,
// RolePickerGateway.
//
// Services depend on the **narrowest** sub-interface they need so the
// domain cores import only the ops they actually use:
//
//   class TicketService          { constructor(...gw: TicketsGateway) }
//   class VerificationService    { constructor(...gw: VerificationGateway) }
//   class ReactionRolesService       { constructor(...gw: ReactionRolesGateway) }
//   class RolePickerService      { constructor(...gw: RolePickerGateway) }
//
// Production wiring (apps/bot) implements the full composite
// DiscordGateway = T & V & S & R — one DjsDiscordGateway instance feeds
// every service. Tests follow the same pattern: a single FakeDiscordGateway
// satisfies all four so tests can assert across domain boundaries when
// needed.
//
// Hard rule (unchanged): services NEVER import 'discord.js' directly.
// Anything richer than `string` / `number` / `bigint` / `readonly
// Record<...>` through this seam is suspicious. discord-api-types is OK
// for embed shapes (types only, no runtime).

// ─── shared payload shapes ───────────────────────────────────────────

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

// Self-roles messages are embed-only — the UI is the bot's pre-added
// reactions on the message itself, not a component row. Keeping the shape
// uniform with the other domains keeps gateway implementations symmetrical
// even though `components` is always empty in practice.
export interface ReactionRolesMessagePayload {
  readonly content: string | undefined;
  readonly embeds: readonly APIEmbed[];
  readonly components: readonly unknown[];
}

// Role-picker messages are an embed plus a single ActionRow containing
// one StringSelectMenu. The component row is part of the message
// payload — unlike reaction-roles, there's no separate "sync reactions"
// step. The bot's djs gateway encodes the menu using
// `StringSelectMenuBuilder` from discord.js; this shape stays JSON to
// keep the seam runtime-free.
export interface RolePickerMessagePayload {
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

// ─── BaseGateway ────────────────────────────────────────────────────
// Operations every domain potentially needs: role grants, role checks,
// member display. Verification + reaction-roles both call assign/remove +
// memberHasRole; tickets uses resolveMemberDisplay for system lines.

export interface BaseGateway {
  /** Grant a role to a guild member. Throws DiscordApiError on Manage Roles
   *  missing, role hierarchy violation, or member fetch failure — the
   *  service layer catches and maps to a `role_assign_failed` /
   *  `noop` audit event so the listener never throws past entry. */
  assignRoleToMember(guildId: string, userId: string, roleId: string): Promise<void>;

  /** Test whether a guild member already holds a role. Used by
   *  verification to short-circuit re-clicks into an `already_verified`
   *  outcome rather than a redundant Discord write. */
  memberHasRole(guildId: string, userId: string, roleId: string): Promise<boolean>;

  /** Revoke a role from a guild member. Same error contract as
   *  assignRoleToMember — service layer maps to `noop` audit. */
  removeRoleFromMember(guildId: string, userId: string, roleId: string): Promise<void>;

  /** Resolve a member's display name for system messages. Returns
   *  id-string fallback if not cached. */
  resolveMemberDisplay(guildId: string, userId: string): Promise<string>;
}

// ─── TicketsGateway ─────────────────────────────────────────────────

export interface TicketsGateway extends BaseGateway {
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

  /** Hard-delete a panel message. Best-effort — silently swallows
   *  already-gone messages. */
  deletePanelMessage(channelId: string, messageId: string): Promise<void>;
}

// ─── VerificationGateway ────────────────────────────────────────────

export interface VerificationGateway extends BaseGateway {
  /** Send a verification message (embed + button row) to a public channel. */
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

  /** Hard-delete a verification message. Best-effort. */
  deleteVerificationMessage(channelId: string, messageId: string): Promise<void>;
}

// ─── ReactionRolesGateway ───────────────────────────────────────────────

export interface ReactionRolesGateway extends BaseGateway {
  /** Send a reaction-roles message to a public channel. The bot will follow
   *  up with syncBotReactions to seed each option's emoji. */
  sendReactionRolesMessage(
    channelId: string,
    payload: ReactionRolesMessagePayload,
  ): Promise<{ messageId: string }>;

  /** Edit an existing reaction-roles message. Reactions are reconciled
   *  separately via syncBotReactions. */
  editReactionRolesMessage(
    channelId: string,
    messageId: string,
    payload: ReactionRolesMessagePayload,
  ): Promise<void>;

  /** Hard-delete a reaction-roles message. Best-effort. */
  deleteReactionRolesMessage(channelId: string, messageId: string): Promise<void>;

  /** Reconcile the bot's own reactions on a reaction-roles message with the
   *  desired set: add anything missing, strip orphan bot reactions from
   *  removed options. User reactions are never touched. Unknown-emoji
   *  failures are best-effort per emoji. */
  syncBotReactions(
    channelId: string,
    messageId: string,
    desiredEmojis: readonly string[],
  ): Promise<void>;
}

// ─── RolePickerGateway ──────────────────────────────────────────────

export interface RolePickerGateway extends BaseGateway {
  /** Send a role-picker message (embed + ActionRow with one
   *  StringSelectMenu) to a public channel. The dropdown is part of the
   *  payload — there is no separate component-sync step. */
  sendRolePickerMessage(
    channelId: string,
    payload: RolePickerMessagePayload,
  ): Promise<{ messageId: string }>;

  /** Edit an existing role-picker message. The payload always includes
   *  the StringSelectMenu — editing options replaces the menu in place
   *  and Discord preserves any in-flight user state on the client. */
  editRolePickerMessage(
    channelId: string,
    messageId: string,
    payload: RolePickerMessagePayload,
  ): Promise<void>;

  /** Hard-delete a role-picker message. Best-effort. */
  deleteRolePickerMessage(channelId: string, messageId: string): Promise<void>;
}

// ─── DiscordGateway ─────────────────────────────────────────────────
// Composite for the production djs implementation and for test fakes
// that span multiple domains. Service-layer code prefers the narrower
// sub-interfaces above.

export type DiscordGateway = TicketsGateway &
  VerificationGateway &
  ReactionRolesGateway &
  RolePickerGateway;
