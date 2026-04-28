import { z } from 'zod';

// Discord snowflakes are 64-bit integers serialized as decimal strings;
// observed range in 2026 is ~17–20 digits. The first snowflake (epoch zero)
// is shorter but never appears in real data, so a 17-digit minimum is safe.
export const SnowflakeSchema = z
  .string()
  .regex(/^\d{17,20}$/, 'Discord snowflake must be 17–20 digits');

/**
 * Coerce an unknown value to a Discord snowflake string. Throws via zod on
 * malformed input. Use at the API/i/o boundary; trusted internal code can
 * skip validation.
 */
export function parseSnowflake(value: unknown): string {
  return SnowflakeSchema.parse(value);
}

/**
 * Parse a comma-separated snowflake list ("123,456" → ["123","456"]). Empty
 * string → empty array (so an unset env var produces an empty list rather
 * than a single empty entry). Each non-empty entry is validated.
 */
export function parseSnowflakeList(value: string): string[] {
  if (value === '') return [];
  const ids = value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
  for (const id of ids) SnowflakeSchema.parse(id);
  return ids;
}
