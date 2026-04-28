// Channel-name normalization for ticket channels.
//
// Discord channel names allow lowercase a-z, digits, hyphens, and underscores;
// max length is 100. We additionally collapse repeated dashes/underscores for
// readability and trim leading/trailing separators. Cyrillic / CJK / emoji
// usernames degrade to a `user-{discordId}` fallback handled by the caller —
// `normalizeUsername` returns an empty string for those so the caller can
// detect the case. `formatChannelName` applies the fallback.

const MAX_NAME_LEN = 80;

/**
 * Strip a username down to Discord-channel-safe characters (lowercase ASCII,
 * digits, hyphen, underscore). Returns empty string when nothing usable remains.
 */
export function normalizeUsername(raw: string): string {
  const lower = raw.toLowerCase();
  // Replace any disallowed run with a single underscore so we don't lose word
  // boundaries (e.g., "Hépì Lu" → "h_p_lu" rather than "hplu").
  const filtered = lower.replace(/[^a-z0-9_-]+/g, '_');
  // Collapse repeated separators introduced by the replacement above.
  const collapsed = filtered.replace(/[_-]{2,}/g, '_');
  // Trim leading/trailing separators.
  return collapsed.replace(/^[_-]+|[_-]+$/g, '');
}

/**
 * Build a ticket channel name as `{number}-{username}`.
 * Falls back to `{number}-user-{userId}` when normalization yields nothing,
 * which preserves uniqueness for non-Latin usernames.
 */
export function formatChannelName(number: number, username: string, userId: string): string {
  const normalized = normalizeUsername(username);
  const safeUser = normalized === '' ? `user-${userId}` : normalized;
  const candidate = `${String(number)}-${safeUser}`;
  return candidate.length <= MAX_NAME_LEN ? candidate : candidate.slice(0, MAX_NAME_LEN);
}
