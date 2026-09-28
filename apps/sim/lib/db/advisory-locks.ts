import { type SQL, sql } from 'drizzle-orm'
import type { DbTransaction } from '@/lib/db/types'

const LOCK_TAG_PATTERN = /^[a-z][a-z0-9_]*$/

/**
 * Renders a SQLCommenter tag naming the lock's caller family. Every advisory
 * lock shares one normalized statement, so the tag is what lets query insights
 * attribute waits to a caller. It trails the statement because tags must
 * precede any terminating semicolon, and it is interpolated raw, so the name is
 * restricted to a static snake_case identifier.
 */
function lockTag(tag: string): SQL {
  if (!LOCK_TAG_PATTERN.test(tag)) throw new Error(`Invalid advisory lock tag: ${tag}`)
  return sql.raw(`/*lock='${tag}'*/`)
}

/**
 * Blocks until the transaction-scoped advisory lock for `key` is held. The lock
 * releases on commit or rollback. It takes a transaction, never the pool: on a
 * pooled connection the statement autocommits, releasing the lock before the
 * caller's work runs.
 */
export async function acquireAdvisoryXactLock(
  tx: DbTransaction,
  tag: string,
  key: string
): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0)) ${lockTag(tag)}`)
}

/**
 * Takes the transaction-scoped advisory lock for `key` without waiting.
 * Returns whether the lock is now held. Like {@link acquireAdvisoryXactLock},
 * it takes a transaction so the lock outlives the statement.
 */
export async function tryAcquireAdvisoryXactLock(
  tx: DbTransaction,
  tag: string,
  key: string
): Promise<boolean> {
  const [lock] = await tx.execute<{ acquired: boolean }>(
    sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${key}, 0)) AS acquired ${lockTag(tag)}`
  )
  return Boolean(lock?.acquired)
}

/** One lock of an {@link acquireAdvisoryXactLocks} set. */
export interface AdvisoryXactLockRequest {
  key: string
  /** Takes the lock in shared mode, which conflicts only with exclusive holders of `key`. */
  shared: boolean
}

/**
 * Blocks until every transaction-scoped advisory lock in `locks` is held, in one round trip.
 * `jsonb_array_elements` emits elements in array order and each row's lock call runs before the
 * next row is read, so the locks are taken exactly in the order given: callers that must not
 * deadlock pass their locks in one global order. The locks release on commit or rollback.
 */
export async function acquireAdvisoryXactLocks(
  tx: DbTransaction,
  tag: string,
  locks: readonly AdvisoryXactLockRequest[]
): Promise<void> {
  if (locks.length === 0) return
  await tx.execute(sql`
    SELECT CASE WHEN (lock ->> 'shared')::boolean
      THEN pg_advisory_xact_lock_shared(hashtextextended(lock ->> 'key', 0))
      ELSE pg_advisory_xact_lock(hashtextextended(lock ->> 'key', 0))
    END
    FROM jsonb_array_elements(${JSON.stringify(locks)}::jsonb) AS lock ${lockTag(tag)}`)
}
