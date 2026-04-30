import { type DbDrizzle, type DbDrizzleTx, isLockNotAvailable, sql } from '@hearth/database';
import { ConflictError, InternalError } from '@hearth/shared';

// Postgres lock_timeout uses milliseconds. When acquisition fails, Postgres
// raises SQLSTATE 55P03 ("lock_not_available"). We catch that specifically
// and surface a ConflictError so the caller can map it to a user-friendly
// "you're already opening a ticket" reply. Any other error inside the
// transaction is wrapped in InternalError to make the failure mode obvious
// in logs.
//
// Currently unused (the openTicket path uses optimistic + partial-unique
// dedupe). PR-7 reattaches it once Drizzle's reliable transaction layer is
// shipped end-to-end, eliminating the orphan-channel rollback path.

export interface AdvisoryLockOptions {
  /** Lock key — see lib/lockKeys.ts for canonical generators. */
  readonly key: bigint;
  /** Acquisition timeout in milliseconds. */
  readonly timeoutMs: number;
}

/**
 * Run `fn` inside a Postgres transaction holding `pg_advisory_xact_lock(key)`.
 * The lock is automatically released when the transaction commits or rolls
 * back, so callers don't manage release manually. `lock_timeout` ensures
 * a stuck holder doesn't pile up waiters indefinitely.
 *
 * Pass-through: the inner function receives the Drizzle transaction client
 * (`tx`) — all DB writes inside `fn` MUST use `tx` so they participate in
 * the same transaction and are protected by the lock.
 *
 * Drizzle's `transaction()` issues `BEGIN`/`COMMIT` directly over `pg.Client`
 * — no driver-adapter abstraction layer that historically dropped Prisma 7
 * transaction ids under VM load. Interactive transactions are reliable.
 */
export async function withAdvisoryLock<T>(
  db: DbDrizzle,
  options: AdvisoryLockOptions,
  fn: (tx: DbDrizzleTx) => Promise<T>,
): Promise<T> {
  try {
    return await db.transaction(async (tx) => {
      // SET LOCAL applies only to this transaction. A literal interpolation
      // is necessary because Postgres parses lock_timeout as a parser-level
      // setting (parameters not allowed). The value is a number we control,
      // so this is safe from injection.
      const timeoutLiteral = Math.max(0, Math.floor(options.timeoutMs));
      await tx.execute(sql.raw(`SET LOCAL lock_timeout = ${String(timeoutLiteral)}`));
      // pg_advisory_xact_lock accepts a single bigint; Drizzle's `sql`
      // serializes ${key} as a parameterized bigint argument.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${options.key})`);
      return await fn(tx);
    });
  } catch (err) {
    if (isLockNotAvailable(err)) {
      throw new ConflictError('Could not acquire lock — operation already in progress', err);
    }
    if (err instanceof ConflictError) {
      throw err;
    }
    if (err instanceof Error) {
      // Re-throw Error instances (including pg unique-violation etc.) so
      // the caller can branch on them; only opaque non-Error values get
      // the InternalError wrapper.
      throw err;
    }
    throw new InternalError('Unexpected non-Error inside advisory-locked transaction', err);
  }
}
