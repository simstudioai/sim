import { db } from '@sim/db'
import { createLogger } from '@sim/logger'
import { getPostgresErrorCode } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { backoffWithJitter } from '@sim/utils/retry'
import type { DbOrTx } from '@/lib/db/types'

const logger = createLogger('DbTransaction')

/**
 * `serialization_failure`, `deadlock_detected`, and `lock_not_available`.
 * Postgres raises all three only after aborting the transaction, so the work is
 * fully rolled back and a fresh attempt is a retry rather than a duplicate.
 *
 * `55P03` is what a caller's own `lock_timeout` produces: it means a competing
 * transaction still held the row, which is the case most likely to succeed on a
 * second attempt. Excluding it would make bounding the wait strictly worse than
 * not bounding it — the request would fail instead of waiting.
 */
const RETRYABLE_TRANSACTION_CODES = new Set(['40001', '40P01', '55P03'])

const DEFAULT_ATTEMPTS = 3

export function isRetryableTransactionError(error: unknown): boolean {
  const code = getPostgresErrorCode(error)
  return code !== undefined && RETRYABLE_TRANSACTION_CODES.has(code)
}

/**
 * Runs `fn` in a transaction, retrying when Postgres aborts it for contention —
 * a deadlock, a serialization failure, or a lock timeout.
 *
 * All three are the database asking the loser to try again, and none leaves
 * partial work behind, so without a retry they surface as a generic 500 for a
 * condition that would have succeeded on a second attempt. Any other error,
 * including the typed domain errors a caller throws to force a rollback,
 * propagates on the first occurrence.
 *
 * Each attempt is its own transaction, so the pooled connection is released
 * between them — pairing a short `lock_timeout` with a retry holds a connection
 * for far less time than a single unbounded wait would.
 *
 * When the attempts are exhausted the original Postgres error propagates;
 * callers that answer HTTP should map it with {@link isRetryableTransactionError}
 * rather than let it become a generic 500.
 *
 * `fn` must be free of side effects outside the transaction: it can run more
 * than once, and only the committing attempt is durable.
 */
export async function withTransactionRetry<T>(
  fn: (tx: DbOrTx) => Promise<T>,
  options: { attempts?: number; label?: string } = {}
): Promise<T> {
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS

  for (let attempt = 1; ; attempt += 1) {
    try {
      return await db.transaction(fn)
    } catch (error) {
      if (attempt >= attempts || !isRetryableTransactionError(error)) throw error
      logger.warn('Retrying transaction aborted by the database', {
        label: options.label,
        attempt,
        code: getPostgresErrorCode(error),
      })
      await sleep(backoffWithJitter(attempt, null, { baseMs: 25, maxMs: 200 }))
    }
  }
}
