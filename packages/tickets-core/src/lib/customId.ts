import { ValidationError } from '@discord-bot/shared';
import { z } from 'zod';

// Discord's component customId hard limit is 100 chars. We reserve 4 for the
// "ticket"/"panel" namespace + ":" separators, leaving generous room for a
// CUID2 (25 chars) plus json. Keep payloads tiny — large state belongs in DB.
const CUSTOM_ID_LIMIT = 100;

// Valid action keys. Adding a new action means updating this union AND the
// PayloadSchemas registry below.
export type CustomIdAction =
  | 'panel:open'
  | 'ticket:claim'
  | 'ticket:close'
  | 'ticket:reopen'
  | 'ticket:delete'
  | 'ticket:delete-confirm';

const PanelOpenPayload = z
  .object({ panelId: z.string().min(1), typeId: z.string().min(1) })
  .strict();
const TicketActionPayload = z.object({ ticketId: z.string().min(1) }).strict();

// Registry maps action → its payload schema. Decoders use this to validate
// the incoming JSON; encoders rely on TypeScript's structural matching.
const PayloadSchemas = {
  'panel:open': PanelOpenPayload,
  'ticket:claim': TicketActionPayload,
  'ticket:close': TicketActionPayload,
  'ticket:reopen': TicketActionPayload,
  'ticket:delete': TicketActionPayload,
  'ticket:delete-confirm': TicketActionPayload,
} as const satisfies Record<CustomIdAction, z.ZodType>;

export type CustomIdPayloadFor<A extends CustomIdAction> = z.infer<(typeof PayloadSchemas)[A]>;

/**
 * Encode an action + payload as a Discord component customId.
 * Format: `<action>|<payloadJSON>`. The pipe separator is JSON-safe and
 * not used by Discord. Throws if the resulting string exceeds 100 chars.
 */
export function encode<A extends CustomIdAction>(
  action: A,
  payload: CustomIdPayloadFor<A>,
): string {
  const encoded = `${action}|${JSON.stringify(payload)}`;
  if (encoded.length > CUSTOM_ID_LIMIT) {
    throw new ValidationError(
      `customId exceeds ${String(CUSTOM_ID_LIMIT)} chars: ${String(encoded.length)} (action=${action})`,
    );
  }
  return encoded;
}

/**
 * Decode a customId string into a typed payload. Validates both the action
 * (must be a known key) and the payload shape (via the registered schema).
 * Throws ValidationError on any mismatch — caller's interaction handler
 * should map this to an ephemeral error reply.
 */
export function decode<A extends CustomIdAction>(
  raw: string,
  expectedAction: A,
): CustomIdPayloadFor<A> {
  const sep = raw.indexOf('|');
  if (sep < 0) {
    throw new ValidationError(`customId missing separator: ${raw.slice(0, 32)}`);
  }
  const action = raw.slice(0, sep);
  if (action !== expectedAction) {
    throw new ValidationError(
      `customId action mismatch: expected ${expectedAction}, got ${action}`,
    );
  }
  const json = raw.slice(sep + 1);
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(json);
  } catch {
    throw new ValidationError(`customId payload is not valid JSON`);
  }
  const schema = PayloadSchemas[expectedAction];
  const result = schema.safeParse(parsedJson);
  if (!result.success) {
    throw new ValidationError(`customId payload failed schema: ${result.error.message}`);
  }
  return result.data as CustomIdPayloadFor<A>;
}

/**
 * Test whether a raw customId begins with a given action prefix. Cheap
 * shortcut for Sapphire's InteractionHandler.parse() — avoids JSON parse
 * for non-matching customIds.
 */
export function matchesAction(raw: string, action: CustomIdAction): boolean {
  return raw.startsWith(`${action}|`);
}
