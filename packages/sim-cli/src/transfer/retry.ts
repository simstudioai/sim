import { setTimeout as sleep } from 'node:timers/promises'
import { backoffWithJitter } from '@sim/utils/retry'
import { SimApiError } from '#sim-cli/http/client'

const MAX_ATTEMPTS = 3
const MAX_RETRY_DELAY_MS = 30_000
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504])

/** Retries only replayable transfer operations; a long Retry-After stops rather than retries early. */
export async function retryTransfer<T>(
  operation: (attempt: number) => Promise<T>,
  options: { signal?: AbortSignal; replayable?: boolean } = {}
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    options.signal?.throwIfAborted()
    try {
      return await operation(attempt)
    } catch (error) {
      options.signal?.throwIfAborted()
      if (
        options.replayable === false ||
        attempt >= MAX_ATTEMPTS ||
        !(error instanceof SimApiError) ||
        (!RETRYABLE_STATUSES.has(error.status) &&
          error.code !== 'TRANSPORT_FAILED' &&
          error.code !== 'RESPONSE_READ_FAILED') ||
        (error.retryAfterMs !== null && error.retryAfterMs > MAX_RETRY_DELAY_MS)
      ) {
        throw error
      }
      await sleep(backoffWithJitter(attempt, error.retryAfterMs), undefined, {
        signal: options.signal,
      })
    }
  }
}
