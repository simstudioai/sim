import { getPostgresErrorCode } from '@sim/utils/errors'
import { sleep as defaultSleep } from '@sim/utils/helpers'
import { backoffWithJitter } from '@sim/utils/retry'

/** SQLSTATE `lock_not_available`, raised when `lock_timeout` expires. */
const LOCK_NOT_AVAILABLE = '55P03'

export interface LockTimeoutRetryAttempt {
  /** The attempt that just failed, starting at 1. */
  attempt: number
  delayMs: number
  elapsedMs: number
  budgetMs: number
}

export interface LockTimeoutRetryOptions {
  /**
   * Time, measured on a monotonic clock from the first attempt, within which
   * attempts may start. No attempt starts once the budget has elapsed, whether
   * the backoff delay would end past it or a timer resolved late; the last lock
   * timeout is thrown instead. An attempt that starts in time can still run for
   * up to one `lock_timeout` past the budget.
   */
  budgetMs: number
  backoff: { baseMs: number; maxMs: number }
  onRetry?: (attempt: LockTimeoutRetryAttempt) => void
  /** Monotonic milliseconds; defaults to `performance.now`, immune to wall-clock corrections. */
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

/**
 * Run `attempt` until it succeeds, retrying only lock timeouts (55P03, found
 * anywhere in the wrapped `cause` chain) for up to `budgetMs`.
 *
 * DDL on a hot table needs an ACCESS EXCLUSIVE lock, which it can only take in
 * a moment when no transaction holds any lock on the table. Each attempt must
 * keep a short `lock_timeout`, because a queued ACCESS EXCLUSIVE request blocks
 * every later query on the table for as long as it waits. Many short attempts
 * spread over a long budget find such a moment without ever stalling traffic
 * for more than one `lock_timeout`; a fixed attempt count gives up after a few
 * minutes whenever the table is continuously held by transactions that each
 * outlive the timeout. Any other error is thrown immediately.
 */
export async function retryOnLockTimeout<T>(
  attempt: (attemptNumber: number) => Promise<T>,
  options: LockTimeoutRetryOptions
): Promise<T> {
  const now = options.now ?? (() => performance.now())
  const sleep = options.sleep ?? defaultSleep
  const startedAt = now()
  for (let attemptNumber = 1; ; attemptNumber++) {
    try {
      return await attempt(attemptNumber)
    } catch (error) {
      if (getPostgresErrorCode(error) !== LOCK_NOT_AVAILABLE) throw error
      const delayMs = backoffWithJitter(attemptNumber, null, options.backoff)
      const elapsedMs = now() - startedAt
      if (elapsedMs + delayMs >= options.budgetMs) throw error
      options.onRetry?.({
        attempt: attemptNumber,
        delayMs,
        elapsedMs,
        budgetMs: options.budgetMs,
      })
      await sleep(delayMs)
      if (now() - startedAt >= options.budgetMs) throw error
    }
  }
}
