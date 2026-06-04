import { SnowflakeSchema } from '@hearth/tickets-core/schemas';
import { z } from 'zod';

// Validation schemas shared between the dashboard forms and the bot slash
// command parsers. Centralised so the handle/channel/toggle invariants
// don't drift between input surfaces. Mirrors the role-picker-core /
// reaction-roles-core schemas layout.

// X handles: 1–15 chars, ASCII letters / digits / underscore. (X's own
// rule; the leading '@' is cosmetic and stripped before validation.)
const HANDLE_PATTERN = /^[A-Za-z0-9_]{1,15}$/;

// Operators paste handles as '@KayenFinance', 'KayenFinance', or even a
// full profile URL fragment with surrounding spaces. Normalise to the
// bare handle before the pattern check so the form accepts what people
// actually type.
const normalizeHandle = (v: unknown): unknown => {
  if (typeof v !== 'string') return v;
  return v
    .trim()
    .replace(/^(?:https?:\/\/)?(?:www\.)?(?:x|twitter)\.com\//i, '')
    .replace(/^@/, '')
    .replace(/[/?].*$/, '');
};

// Forms render unticked checkboxes as absent rather than `false` in some
// paths; coerce the loose boolean inputs so a string 'true'/'false' from
// a form field maps correctly. Slash commands already pass real booleans.
const toBool = (v: unknown): unknown => {
  if (v === 'true') return true;
  if (v === 'false') return false;
  return v;
};

// Per-watcher poll cadence bounds (seconds). 30s floor / 1h ceiling —
// matches the base-tick env range. The base tick effectively floors the
// real cadence, so values below the base just behave as the base.
const pollIntervalSec = z.preprocess(
  (v) => (v === '' || v === undefined ? undefined : Number(v)),
  z.number().int().min(30).max(3600).optional(),
);

/** `/xwatcher add` (or dashboard "New watcher" form) input. */
export const XWatcherInputSchema = z.object({
  guildId: SnowflakeSchema,
  sourceHandle: z.preprocess(normalizeHandle, z.string().regex(HANDLE_PATTERN, 'invalid X handle')),
  channelId: SnowflakeSchema,
  includeQuotes: z.preprocess(toBool, z.boolean().optional()),
  includeReplies: z.preprocess(toBool, z.boolean().optional()),
  enabled: z.preprocess(toBool, z.boolean().optional()),
  pollIntervalSec,
});
export type XWatcherInput = z.infer<typeof XWatcherInputSchema>;

/** Edit subset. The source account is immutable (changing it would
 *  orphan the dedupe cursor) — only the destination + toggles change. */
export const XWatcherEditSchema = z.object({
  channelId: SnowflakeSchema.optional(),
  includeQuotes: z.preprocess(toBool, z.boolean().optional()),
  includeReplies: z.preprocess(toBool, z.boolean().optional()),
  enabled: z.preprocess(toBool, z.boolean().optional()),
  pollIntervalSec,
});
export type XWatcherEdit = z.infer<typeof XWatcherEditSchema>;
