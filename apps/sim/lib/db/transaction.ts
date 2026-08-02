import { db } from '@sim/db'
import { createLogger } from '@sim/logger'
import { getPostgresErrorCode } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { backoffWithJitter } from '@sim/utils/retry'
import type { DbOrTx } from '@/lib/db/types'

const logger = createLogger('DbTransaction')

/**
 * `serialization_failure` and `deadlock_detected`. Postgres raises both only
 * after aborting and fully rolling back the transaction, which is what makes a
 * fresh attempt safe rather than a duplicate.
 */
const RETRYABLE_TRANSACTION_CODES = new Set(['40001', '40P01'])

const DEFAULT_ATTEMPTS = 3

export function isRetryableTransactionError(error: unknown): boolean {
  const code = getPostgresErrorCode(error)
  return code !== undefined && RETRYABLE_TRANSACTION_CODES.has(code)
}

/**
 * Runs `fn` in a transaction, retrying when Postgres aborts it as a deadlock
 * victim or on a serialization failure.
 *
 * Both are the database asking the loser to try again, and neither leaves
 * partial work behind — so without a retry they surface as a generic 500 for a
 * condition that would have succeeded on a second attempt. Any other error,
 * including the typed domain errors a caller throws to force a rollback,
 * propagates on the first occurrence.
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
