import { SnowflakeSchema } from '@hearth/tickets-core/schemas';
import { z } from 'zod';

// Validation schemas shared between forms (dashboard) and slash command
// option parsers (bot). Centralised so invariants don't drift between
// input surfaces. Mirrors the verification-core / reaction-roles-core
// schemas layout.

// Discord caps message embeds at 256-char titles and 4000-char
// descriptions. Same as the other domains.
const EMBED_TITLE_MAX = 256;
const EMBED_DESC_MAX = 4000;

// Role-picker options surface inside a StringSelectMenu. Discord caps
// the menu at 25 options per submission (StringSelectMenu hard limit).
// We match that ceiling — forking from reaction-roles' 20-cap, which was
// driven by Discord's *reaction* limit on a single message.
const MAX_OPTIONS_PER_PANEL = 25;

// StringSelectMenu option labels render in the dropdown row; Discord
// allows up to 100 chars but a tighter bound keeps the dropdown
// readable. Description is the optional sub-line under the label —
// Discord caps it at 100 chars too.
const LABEL_MAX = 80;
const DESCRIPTION_MAX = 100;

// StringSelectMenu placeholder shown when nothing is selected. Discord
// caps it at 150 chars.
const PLACEHOLDER_MAX = 150;

// Same emoji pattern as reaction-roles. Unicode or `<a?:name:id>`. The
// service stores the raw string; the djs gateway parses the
// `<a?:name:id>` form into `{id, name, animated}` for the
// StringSelectMenuOption.
const EMOJI_PATTERN = /^(?:<a?:[A-Za-z0-9_]{2,32}:\d{17,20}>|.{1,32})$/u;

// v1 ships with these locked to 'single' / 1 / 1 in the dashboard form.
// The schema accepts the broader range so v2 multi-select unlocks
// purely on the form side — no migration required.
const SELECTION_MODE_VALUES = ['single', 'multi'] as const;

// Forms render optional text inputs as `""` when blank — not `undefined`.
// `.optional()` only matches the literal undefined, so an `.optional()`
// chain followed by `.min(1)` rejects the empty string with a confusing
// "must contain at least 1 character" error on a field labelled
// "(optional)". Preprocess `""` → `undefined` so the chain reads as
// the operator expects: empty stays optional, present is validated.
const emptyAsUndefined = (v: unknown): unknown => (v === '' ? undefined : v);

/** `/rolepicker create` (or dashboard "New role-picker panel" form) input. */
export const RolePickerPanelInputSchema = z.object({
  guildId: SnowflakeSchema,
  channelId: SnowflakeSchema,
  embedTitle: z.string().min(1).max(EMBED_TITLE_MAX).optional(),
  embedDescription: z.string().min(1).max(EMBED_DESC_MAX).optional(),
  placeholder: z.string().min(1).max(PLACEHOLDER_MAX).optional(),
  selectionMode: z.enum(SELECTION_MODE_VALUES).optional(),
  minValues: z.number().int().min(0).max(MAX_OPTIONS_PER_PANEL).optional(),
  maxValues: z.number().int().min(1).max(MAX_OPTIONS_PER_PANEL).optional(),
});
export type RolePickerPanelInput = z.infer<typeof RolePickerPanelInputSchema>;

/** Edit subset — channel can change, guildId cannot. */
export const RolePickerPanelEditSchema = z.object({
  channelId: SnowflakeSchema.optional(),
  embedTitle: z.string().min(1).max(EMBED_TITLE_MAX).optional(),
  embedDescription: z.string().min(1).max(EMBED_DESC_MAX).optional(),
  placeholder: z.string().min(1).max(PLACEHOLDER_MAX).optional(),
  selectionMode: z.enum(SELECTION_MODE_VALUES).optional(),
  minValues: z.number().int().min(0).max(MAX_OPTIONS_PER_PANEL).optional(),
  maxValues: z.number().int().min(1).max(MAX_OPTIONS_PER_PANEL).optional(),
});
export type RolePickerPanelEdit = z.infer<typeof RolePickerPanelEditSchema>;

/** `/rolepicker option add` (or dashboard "Add option" form) input. Each
 *  option owns its own role — selecting maps the option's value to that
 *  role grant. */
export const RolePickerOptionInputSchema = z.object({
  label: z.string().min(1).max(LABEL_MAX),
  description: z.preprocess(emptyAsUndefined, z.string().min(1).max(DESCRIPTION_MAX).optional()),
  emoji: z.preprocess(
    emptyAsUndefined,
    z.string().regex(EMOJI_PATTERN, 'invalid emoji').optional(),
  ),
  roleId: SnowflakeSchema,
  position: z
    .number()
    .int()
    .min(0)
    .max(MAX_OPTIONS_PER_PANEL - 1),
});
export type RolePickerOptionInput = z.infer<typeof RolePickerOptionInputSchema>;

/** Edit subset — all fields optional. */
export const RolePickerOptionEditSchema = z.object({
  label: z.string().min(1).max(LABEL_MAX).optional(),
  description: z.preprocess(
    emptyAsUndefined,
    z.string().min(1).max(DESCRIPTION_MAX).nullable().optional(),
  ),
  emoji: z.preprocess(
    emptyAsUndefined,
    z.string().regex(EMOJI_PATTERN, 'invalid emoji').nullable().optional(),
  ),
  roleId: SnowflakeSchema.optional(),
  position: z
    .number()
    .int()
    .min(0)
    .max(MAX_OPTIONS_PER_PANEL - 1)
    .optional(),
});
export type RolePickerOptionEdit = z.infer<typeof RolePickerOptionEditSchema>;

export { MAX_OPTIONS_PER_PANEL };
