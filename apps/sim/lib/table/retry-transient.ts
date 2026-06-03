import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { backoffWithJitter } from '@sim/utils/retry'
import { isRetryableInfrastructureError } from '@/lib/core/errors/retryable-infrastructure'

const logger = createLogger('TableRetryTransient')

/** Cell-task DB/Redis round-trips are short and idempotent reads/guarded
 *  writes, so a handful of fast retries comfortably outlasts a transient
 *  connection drop without risking duplicate side effects. */
const DEFAULT_MAX_ATTEMPTS = 4

/** Redis-side equivalents of a dropped socket. Excludes connection-STATE
 *  programming errors (e.g. "Connection is in subscriber mode"), which are
 *  misconfigurations that would just fail identically on every retry. */
const RETRYABLE_REDIS_MESSAGE = /Command timed out|Connection is closed|Stream isn't writeable/i

/**
 * ioredis surfaces command timeouts and severed connections as plain `Error`s
 * with no `code`/`errno`, so the SQLSTATE/errno-based
 * {@link isRetryableInfrastructureError} classifier misses them. Match those by
 * message instead, walking the `.cause` chain (depth-bounded) so a wrapped
 * Redis failure is still recognized — mirroring how the infra classifier walks
 * causes.
 */
function isRetryableRedisError(error: unknown): boolean {
  let current: unknown = error
  for (let depth = 0; depth < 10 && current instanceof Error; depth++) {
    if (RETRYABLE_REDIS_MESSAGE.test(current.message)) return true
    current = current.cause
  }
  return false
}

/**
 * True when `error` is a transient infrastructure failure worth retrying — a
 * dropped Postgres connection (08xxx / network errno, via the shared
 * classifier) or a timed-out/closed Redis command.
 */
export function isRetryableCellError(error: unknown): boolean {
  return isRetryableInfrastructureError(error) || isRetryableRedisError(error)
}

interface RetryTransientOptions {
  maxAttempts?: number
  /** Abort between attempts (e.g. trigger.dev cancellation). Aborting rethrows
   *  the last error rather than waiting out another backoff. */
  signal?: AbortSignal
}

/**
 * Runs `fn`, retrying only on transient infrastructure errors with jittered
 * backoff. Non-transient errors rethrow immediately; transient errors rethrow
 * once `maxAttempts` is exhausted — this is resilience, not error suppression.
 *
 * The cell task runs under trigger.dev `maxAttempts: 1`, so without this a
 * single dropped DB/Redis connection mid-cascade kills the run and strands the
 * cell in `running`. The backends answer these queries in sub-milliseconds once
 * a fresh connection is established, so a short backoff reliably recovers.
 */
export async function retryTransient<T>(
  label: string,
  fn: () => Promise<T>,
  options: RetryTransientOptions = {}
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn()
    } catch (error) {
      if (options.signal?.aborted || attempt >= maxAttempts || !isRetryableCellError(error)) {
        throw error
      }
      const waitMs = backoffWithJitter(attempt, null, { baseMs: 250, maxMs: 5_000 })
      logger.warn(
        `Transient failure in ${label} (attempt ${attempt}/${maxAttempts}); retrying in ${Math.round(waitMs)}ms`,
        { error: getErrorMessage(error) }
      )
      await sleep(waitMs)
      // Re-check after backoff: if cancellation fired during the sleep, don't
      // run another attempt (and don't return a success from work that started
      // after the task was already cancelled).
      if (options.signal?.aborted) throw error
    }
  }
}
