// Postgres `pg_advisory_xact_lock(key bigint)` accepts a single 64-bit signed
// integer. We hash a tuple of (guild, opener, type) into a deterministic
// signed bigint via FNV-1a 64-bit. The hash space is 2^64; collisions across
// distinct tuples are astronomically unlikely (~2^32 entries → ~2^-1 prob).
// Even on collision the lock is harmless extra serialization, never wrong.

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;
const SIGN_BIT = 0x8000000000000000n;

/** FNV-1a 64-bit hash of a UTF-8 string, returned as an unsigned bigint. */
function fnv1a64(input: string): bigint {
  let hash = FNV_OFFSET;
  const bytes = new TextEncoder().encode(input);
  for (const b of bytes) {
    hash ^= BigInt(b);
    hash = (hash * FNV_PRIME) & MASK_64;
  }
  return hash;
}

/** Convert an unsigned 64-bit bigint to its two's-complement signed form. */
function toSigned64(unsigned: bigint): bigint {
  return unsigned >= SIGN_BIT ? unsigned - (MASK_64 + 1n) : unsigned;
}

/**
 * Lock key for ticket-open contention: serializes concurrent open requests
 * from the same (guild, opener, type) so the partial unique index never
 * has to do the work alone. The key is stable across processes — two bot
 * instances running at the same time will block each other on the same input.
 */
export function ticketOpenLockKey(guildId: string, openerId: string, panelTypeId: string): bigint {
  return toSigned64(fnv1a64(`ticket-open|${guildId}|${openerId}|${panelTypeId}`));
}
