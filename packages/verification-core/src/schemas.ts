import { SnowflakeSchema } from '@hearth/tickets-core/schemas';
import { z } from 'zod';

// Validation schemas shared between forms (dashboard) and slash command
// option parsers (bot). Centralised here so invariants don't drift between
// input surfaces. Mirrors the tickets-core/schemas pattern.

const BUTTON_STYLES = ['primary', 'secondary', 'success', 'danger'] as const;

// Discord button labels are capped at 80 chars. We pre-validate to surface
// a clean form error rather than a 400 from Discord's REST API at click time.
const BUTTON_LABEL_MAX = 80;

// Allow Unicode emoji or a Discord custom emoji reference shape
// `<:name:id>` / `<a:name:id>`. v1 dashboard form restricts to Unicode;
// the bot slash command accepts the broader form so future custom-emoji
// support doesn't require a schema change.
const EMOJI_PATTERN = /^(?:<a?:[A-Za-z0-9_]{2,32}:\d{17,20}>|.{1,32})$/u;

/** `/verification create` (or dashboard "New verification panel" form) input. */
export const VerificationPanelInputSchema = z.object({
  guildId: SnowflakeSchema,
  channelId: SnowflakeSchema,
  embedTitle: z.string().min(1).max(256).optional(),
  embedDescription: z.string().min(1).max(4000).optional(),
  roleId: SnowflakeSchema,
});
export type VerificationPanelInput = z.infer<typeof VerificationPanelInputSchema>;

/** Subset accepted by the panel-edit flow — channel and role can change,
 *  but not guildId (the panel is bound to its guild). */
export const VerificationPanelEditSchema = z.object({
  channelId: SnowflakeSchema.optional(),
  embedTitle: z.string().min(1).max(256).optional(),
  embedDescription: z.string().min(1).max(4000).optional(),
  roleId: SnowflakeSchema.optional(),
});
export type VerificationPanelEdit = z.infer<typeof VerificationPanelEditSchema>;

/** `/verification option add` (or dashboard "Add option" form) input. */
export const VerificationOptionInputSchema = z.object({
  label: z.string().min(1).max(BUTTON_LABEL_MAX),
  emoji: z.string().regex(EMOJI_PATTERN, 'invalid emoji'),
  buttonStyle: z.enum(BUTTON_STYLES),
  // Discord action rows hold up to 5 buttons → 0..4 inclusive.
  position: z.number().int().min(0).max(4),
});
export type VerificationOptionInput = z.infer<typeof VerificationOptionInputSchema>;

/** Same fields as add, all optional — matches the partial-update flow. */
export const VerificationOptionEditSchema = z.object({
  label: z.string().min(1).max(BUTTON_LABEL_MAX).optional(),
  emoji: z.string().regex(EMOJI_PATTERN, 'invalid emoji').optional(),
  buttonStyle: z.enum(BUTTON_STYLES).optional(),
  position: z.number().int().min(0).max(4).optional(),
});
export type VerificationOptionEdit = z.infer<typeof VerificationOptionEditSchema>;
