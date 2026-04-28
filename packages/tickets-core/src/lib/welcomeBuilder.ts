import {
  type APIActionRowComponent,
  type APIButtonComponentWithCustomId,
  type APIComponentInMessageActionRow,
  type APIEmbed,
  ButtonStyle,
  ComponentType,
} from 'discord-api-types/v10';

import { tickets as i18nTickets } from '../i18n/index.js';

import { encode } from './customId.js';

// Welcome message state machine.
//
// open    → Close(secondary) ✅, Delete(danger) ✅
// claimed → Close ✅, Delete ✅                          (claim/reopen still work
// closed  → Close(disabled), Delete(danger) ✅            via service layer; only
//                                                        the buttons are hidden)
//
// The buttons are stateless — every customId encodes only `ticketId`, so the
// bot reads current state from the DB on every click. This means redeploys
// and crashes never leave a stale button.

export type WelcomeButtonState = 'open' | 'claimed' | 'closed';

export interface WelcomeMessageInput {
  readonly state: WelcomeButtonState;
  readonly ticketId: string;
  readonly claimedByDisplay?: string;
  /**
   * Override copy for the welcome body. Falls back to i18n.tickets.welcome.default.
   * Lets a PanelTicketType.welcomeMessage customize per-type without code changes.
   */
  readonly bodyOverride?: string;
}

export interface WelcomeBranding {
  readonly color: number;
  readonly footerText: string | undefined;
}

export interface WelcomeMessagePayload {
  readonly content: string | undefined;
  readonly embeds: APIEmbed[];
  readonly components: APIActionRowComponent<APIComponentInMessageActionRow>[];
}

export function buildWelcomeMessage(
  input: WelcomeMessageInput,
  branding: WelcomeBranding,
): WelcomeMessagePayload {
  const body = input.bodyOverride ?? i18nTickets.welcome.default;
  const embed: APIEmbed = {
    description: body,
    color: branding.color,
    ...(branding.footerText !== undefined ? { footer: { text: branding.footerText } } : {}),
  };
  return {
    content: undefined,
    embeds: [embed],
    components: buildButtons(input),
  };
}

function buildButtons(
  input: WelcomeMessageInput,
): APIActionRowComponent<APIComponentInMessageActionRow>[] {
  const close: APIButtonComponentWithCustomId = {
    type: ComponentType.Button,
    style: ButtonStyle.Secondary,
    custom_id: encode('ticket:close', { ticketId: input.ticketId }),
    label: i18nTickets.buttons.close,
    emoji: { name: '🔒' },
    disabled: input.state === 'closed',
  };
  const del: APIButtonComponentWithCustomId = {
    type: ComponentType.Button,
    style: ButtonStyle.Danger,
    custom_id: encode('ticket:delete', { ticketId: input.ticketId }),
    label: i18nTickets.buttons.delete,
    emoji: { name: '🗑️' },
  };
  return [
    {
      type: ComponentType.ActionRow,
      components: [close, del],
    },
  ];
}
