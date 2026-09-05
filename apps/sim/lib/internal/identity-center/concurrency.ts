import { interruptibleSleep } from '@sim/utils/helpers'
import { backoffWithJitter } from '@sim/utils/retry'

/**
 * Ceiling on simultaneous per-item AWS calls issued while expanding a list
 * page. `ListPermissionSets` returns up to 100 ARNs in one page, so an
 * uncapped fan-out would fire 100 concurrent `DescribePermissionSet` calls and
 * throttle itself.
 */
export const AWS_FANOUT_CONCURRENCY = 6

/** Total attempts (initial + retries) for a throttled AWS call. */
const MAX_THROTTLE_ATTEMPTS = 4

const THROTTLE_ERROR_NAMES = new Set([
  'ThrottlingException',
  'Throttling',
  'ThrottledException',
  'TooManyRequestsException',
  'RequestLimitExceeded',
  'RequestThrottled',
  'RequestThrottledException',
  'SlowDown',
])

function isThrottlingError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const candidate = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } }
  if (typeof candidate.name === 'string' && THROTTLE_ERROR_NAMES.has(candidate.name)) return true
  return candidate.$metadata?.httpStatusCode === 429
}

/**
 * Runs an AWS call, retrying with jittered exponential backoff while the
 * service reports throttling. Non-throttling failures and aborts propagate
 * immediately.
 *
 * The backoff itself is interruptible: an abort during the wait resolves it
 * early, so the next loop iteration's `throwIfAborted` fires without the caller
 * having to sit out the remaining delay.
 */
export async function withThrottleRetry<T>(
  operation: () => Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    signal?.throwIfAborted()
    try {
      return await operation()
    } catch (error) {
      if (attempt >= MAX_THROTTLE_ATTEMPTS || !isThrottlingError(error)) throw error
      await interruptibleSleep(
        backoffWithJitter(attempt, null, { baseMs: 200, maxMs: 5_000 }),
        signal
      )
    }
  }
}

/**
 * Maps `items` through `fn` with at most `limit` calls in flight, preserving
 * input order in the result. The first rejection propagates and no further
 * items are started.
 */
export async function mapWithConcurrency<TItem, TResult>(
  items: readonly TItem[],
  limit: number,
  fn: (item: TItem, index: number) => Promise<TResult>
): Promise<TResult[]> {
  const results = new Array<TResult>(items.length)
  let cursor = 0
  let failed = false

  const worker = async (): Promise<void> => {
    while (!failed && cursor < items.length) {
      const index = cursor++
      try {
        results[index] = await fn(items[index], index)
      } catch (error) {
        failed = true
        throw error
      }
    }
  }

  const workerCount = Math.min(Math.max(1, limit), items.length)
  await Promise.all(Array.from({ length: workerCount }, worker))
  return results
}
