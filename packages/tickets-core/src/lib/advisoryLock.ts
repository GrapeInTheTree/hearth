import { type DbClient, Prisma } from '@discord-bot/database';
import { ConflictError, InternalError } from '@discord-bot/shared';

// Postgres lock_timeout uses milliseconds. When acquisition fails, Postgres
// raises SQLSTATE 55P03 ("lock_not_available"). We catch that specifically
// and surface a ConflictError so the caller can map it to a user-friendly
// "you're already opening a ticket" reply. Any other Prisma error is wrapped
// in InternalError to make the failure mode obvious in logs.

const LOCK_NOT_AVAILABLE_SQLSTATE = '55P03';

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
 * Pass-through: the inner function receives the transaction client (`tx`)
 * — all DB writes inside `fn` MUST use `tx` so they participate in the
 * same transaction and are protected by the lock.
 */
export async function withAdvisoryLock<T>(
  db: DbClient,
  options: AdvisoryLockOptions,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  try {
    return await db.$transaction(async (tx) => {
      // SET LOCAL applies only to this transaction. A literal interpolation
      // is necessary because Postgres parses lock_timeout as a parser-level
      // setting (parameters not allowed). The value is a number we control,
      // so this is safe from injection.
      const timeoutLiteral = Math.max(0, Math.floor(options.timeoutMs));
      await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = ${String(timeoutLiteral)}`);
      // pg_advisory_xact_lock accepts a single bigint; Prisma serializes
      // ${key} as a parameterized bigint argument.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${options.key})`;
      return await fn(tx);
    });
  } catch (err) {
    if (isPostgresError(err, LOCK_NOT_AVAILABLE_SQLSTATE)) {
      throw new ConflictError('Could not acquire lock — operation already in progress', err);
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      // Re-throw P2002 etc. so the caller can branch on them.
      throw err;
    }
    if (err instanceof ConflictError) {
      throw err;
    }
    throw new InternalError('Unexpected error inside advisory-locked transaction', err);
  }
}

function isPostgresError(err: unknown, sqlstate: string): boolean {
  if (typeof err !== 'object' || err === null) return false;
  if (!('code' in err)) return false;
  return (err as { code?: unknown }).code === sqlstate;
}
