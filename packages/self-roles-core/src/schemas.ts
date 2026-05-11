import { SnowflakeSchema } from '@hearth/tickets-core/schemas';
import { z } from 'zod';

// Validation schemas shared between forms (dashboard) and slash command
// option parsers (bot). Centralised here so invariants don't drift between
// input surfaces. Mirrors the verification-core/schemas pattern.

// Discord caps message embeds at 256-char titles and 4000-char descriptions.
// Mirroring the verification limits keeps the operator surface uniform.
const EMBED_TITLE_MAX = 256;
const EMBED_DESC_MAX = 4000;

// Self-roles options surface as message reactions. Discord caps a single
// message at 20 distinct emoji reactions (REST returns code 30010 on the
// 21st). We match that hard ceiling — Discord wraps the strip into a
// second row past ~8 emoji, which is the same behaviour every other
// reaction-roles bot exposes.
const MAX_OPTIONS_PER_PANEL = 20;

// Label is visible only in the embed body (option_line). Discord rejects
// embed fields longer than 256 chars; we cap shorter to leave room for the
// rendered role mention.
const LABEL_MAX = 80;

// Allow Unicode emoji (e.g. '🇺🇸') or a Discord custom emoji reference
// `<:name:id>` / `<a:name:id>`. Custom emoji only work if the bot is in a
// guild that exposes them — runtime 10014 is mapped to a 'noop' audit
// event at the gateway layer rather than rejected at form time.
const EMOJI_PATTERN = /^(?:<a?:[A-Za-z0-9_]{2,32}:\d{17,20}>|.{1,32})$/u;

/** `/selfroles create` (or dashboard "New self-roles panel" form) input. */
export const SelfRolesPanelInputSchema = z.object({
  guildId: SnowflakeSchema,
  channelId: SnowflakeSchema,
  embedTitle: z.string().min(1).max(EMBED_TITLE_MAX).optional(),
  embedDescription: z.string().min(1).max(EMBED_DESC_MAX).optional(),
});
export type SelfRolesPanelInput = z.infer<typeof SelfRolesPanelInputSchema>;

/** Subset accepted by the panel-edit flow — channel can change, guildId
 *  cannot (panel is bound to its guild). */
export const SelfRolesPanelEditSchema = z.object({
  channelId: SnowflakeSchema.optional(),
  embedTitle: z.string().min(1).max(EMBED_TITLE_MAX).optional(),
  embedDescription: z.string().min(1).max(EMBED_DESC_MAX).optional(),
});
export type SelfRolesPanelEdit = z.infer<typeof SelfRolesPanelEditSchema>;

/** `/selfroles option add` (or dashboard "Add option" form) input. Each
 *  option owns its own role — multi-select is native to reactions. */
export const SelfRolesOptionInputSchema = z.object({
  label: z.string().min(1).max(LABEL_MAX),
  emoji: z.string().regex(EMOJI_PATTERN, 'invalid emoji'),
  roleId: SnowflakeSchema,
  position: z
    .number()
    .int()
    .min(0)
    .max(MAX_OPTIONS_PER_PANEL - 1),
});
export type SelfRolesOptionInput = z.infer<typeof SelfRolesOptionInputSchema>;

/** Same fields as add, all optional — matches the partial-update flow. */
export const SelfRolesOptionEditSchema = z.object({
  label: z.string().min(1).max(LABEL_MAX).optional(),
  emoji: z.string().regex(EMOJI_PATTERN, 'invalid emoji').optional(),
  roleId: SnowflakeSchema.optional(),
  position: z
    .number()
    .int()
    .min(0)
    .max(MAX_OPTIONS_PER_PANEL - 1)
    .optional(),
});
export type SelfRolesOptionEdit = z.infer<typeof SelfRolesOptionEditSchema>;

export { MAX_OPTIONS_PER_PANEL };
