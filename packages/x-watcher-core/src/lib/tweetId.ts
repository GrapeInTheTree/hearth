// X status ids are 64-bit snowflakes that exceed Number.MAX_SAFE_INTEGER,
// so they're carried as strings everywhere. Ordering and "is this newer
// than the cursor" comparisons must therefore be numeric-on-BigInt, not
// lexicographic (string compare gets "9" > "10" wrong, and even
// equal-length ids can't be trusted across id-length growth).

/** Compare two X status ids numerically. Returns <0 if a is older, >0 if
 *  a is newer, 0 if equal. Falls back to string comparison if either id
 *  isn't a clean integer (defensive — a well-behaved source always emits
 *  numeric ids; an RSS source must parse the status id out of the URL). */
export function compareTweetId(a: string, b: string): number {
  let ba: bigint;
  let bb: bigint;
  try {
    ba = BigInt(a);
    bb = BigInt(b);
  } catch {
    return a < b ? -1 : a > b ? 1 : 0;
  }
  return ba < bb ? -1 : ba > bb ? 1 : 0;
}

/** True when `candidate` is strictly newer than `cursor`. A null cursor
 *  (watcher never seeded) means nothing is "newer" yet — the first poll
 *  seeds the cursor instead of posting. */
export function isNewerThan(candidate: string, cursor: string | null): boolean {
  if (cursor === null) return false;
  return compareTweetId(candidate, cursor) > 0;
}
