// Postgres error helpers. Drizzle wraps pg's native errors in its own
// `Error('Failed query: …')` with `cause` set to the underlying pg error
// (which carries `code`, `constraint`, `detail`). These helpers walk the
// wrap chain so service code never hard-codes magic strings or branches
// on cause-vs-no-cause.
//
// SQLSTATE reference: https://www.postgresql.org/docs/current/errcodes-appendix.html
//   23505 — unique_violation (e.g. partial unique index `ticket_open_dedupe`)
//   23503 — foreign_key_violation (e.g. RESTRICT-blocked Panel.delete)
//   55P03 — lock_not_available (advisory lock acquisition timeout)

interface PgErrorShape {
  readonly code?: string;
  readonly constraint?: string;
  readonly detail?: string;
  readonly cause?: unknown;
}

function asPgError(e: unknown): PgErrorShape | null {
  if (typeof e !== 'object' || e === null) return null;
  return e as PgErrorShape;
}

/** Walk the cause chain looking for a node with the requested SQLSTATE.
 *  Drizzle wraps pg errors as `{ message, query, params, cause: <pgError> }`;
 *  some test runners may double-wrap, so we follow `cause` until null. */
function findByCode(e: unknown, code: string): PgErrorShape | null {
  let current: PgErrorShape | null = asPgError(e);
  let depth = 0;
  while (current !== null && depth < 5) {
    if (current.code === code) return current;
    current = asPgError(current.cause);
    depth += 1;
  }
  return null;
}

export function isUniqueViolation(e: unknown): boolean {
  return findByCode(e, '23505') !== null;
}

export function isLockNotAvailable(e: unknown): boolean {
  return findByCode(e, '55P03') !== null;
}

export function isForeignKeyViolation(e: unknown): boolean {
  return findByCode(e, '23503') !== null;
}

/** Returns the offending constraint name from the first pg error in the
 *  cause chain. Useful to distinguish `ticket_open_dedupe` (alreadyOpen)
 *  from `Ticket_channelId_key` (channel id collision). */
export function getConstraintName(e: unknown): string | undefined {
  let current: PgErrorShape | null = asPgError(e);
  let depth = 0;
  while (current !== null && depth < 5) {
    if (current.constraint !== undefined) return current.constraint;
    current = asPgError(current.cause);
    depth += 1;
  }
  return undefined;
}
