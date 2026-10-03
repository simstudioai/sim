import { getTransientDatabaseFailure } from '@sim/utils/errors'
import { backoffWithJitter } from '@sim/utils/retry'

/**
 * What a Trigger.dev `catchError` hook returns: retry at a chosen time, stop retrying, or
 * (`undefined`) fall back to the task's own `retry` settings.
 */
export type BackgroundRetryDecision = { retryAt: Date } | { skipRetrying: true } | undefined

export interface BackgroundRetryPolicy {
  /** Attempts for every failure other than a transient database failure. */
  maxAttempts: number
  /**
   * Attempts and pacing when the database was transiently unavailable (capacity, conflict, or
   * connection). Delays are minutes, not seconds, so the retries outlast a slow window instead of
   * all landing inside it; the attempt ceiling keeps a failure that only looks transient bounded.
   */
  database: {
    maxAttempts: number
    baseDelayMs: number
    maxDelayMs: number
  }
}

/** The `retry.maxAttempts` a task must declare so neither kind of failure is cut short. */
export function backgroundRetryAttemptCeiling(policy: BackgroundRetryPolicy): number {
  return Math.max(policy.maxAttempts, policy.database.maxAttempts)
}

/**
 * When to run the next attempt after `attempt` (1-based) failed on a transient database failure,
 * or `null` when the error is not one or its attempts are spent.
 */
export function getDatabaseRetryAt(
  error: unknown,
  attempt: number,
  policy: BackgroundRetryPolicy,
  now = Date.now()
): Date | null {
  if (!getTransientDatabaseFailure(error)) return null
  if (attempt >= policy.database.maxAttempts) return null
  const delayMs = backoffWithJitter(attempt, null, {
    baseMs: policy.database.baseDelayMs,
    maxMs: policy.database.maxDelayMs,
  })
  return new Date(now + delayMs)
}

/**
 * Chooses the next attempt after `attempt` (1-based) failed. A transient database failure backs
 * off on the policy's database pacing up to its own ceiling; anything else keeps the task's
 * ordinary retries and stops at `maxAttempts`.
 */
export function getBackgroundRetryDecision(
  error: unknown,
  attempt: number,
  policy: BackgroundRetryPolicy,
  now = Date.now()
): BackgroundRetryDecision {
  if (getTransientDatabaseFailure(error)) {
    const retryAt = getDatabaseRetryAt(error, attempt, policy, now)
    return retryAt ? { retryAt } : { skipRetrying: true }
  }
  return attempt >= policy.maxAttempts ? { skipRetrying: true } : undefined
}
