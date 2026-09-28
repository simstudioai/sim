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
