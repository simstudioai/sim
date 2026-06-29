import { createLogger } from '@/lib/logging/client'

const logger = createLogger('retry')

export interface RetryOptions {
  maxRetries?: number
  initialDelayMs?: number
  maxDelayMs?: number
  retryableStatusCodes?: number[]
}

const RETRY_DEFAULTS = {
  MAX_RETRIES: 3,
  INITIAL_DELAY_MS: 1000,
  MAX_DELAY_MS: 30000,
  RETRYABLE_STATUS_CODES: [429, 503, 529],
} as const

function calculateBackoffDelay(attempt: number, initialDelayMs: number, maxDelayMs: number): number {
  const exponential = initialDelayMs * Math.pow(2, attempt)
  const capped = Math.min(maxDelayMs, exponential)
  const jitter = Math.random() * capped * 0.2
  return Math.floor(Math.min(capped + jitter, maxDelayMs))
}

function parseRetryAfterHeader(headers: Headers): number | null {
  const retryAfter = headers.get('retry-after')
  if (!retryAfter) return null
  const seconds = parseFloat(retryAfter)
  if (!isNaN(seconds)) return Math.ceil(seconds * 1000)
  const date = new Date(retryAfter)
  if (!isNaN(date.getTime())) {
    const delayMs = date.getTime() - Date.now()
    return delayMs > 0 ? delayMs : null
  }
  return null
}

/**
 * Returns true only for known transient network errors (no HTTP status code).
 * Deliberately excludes JS runtime errors (TypeError, RangeError, etc.)
 * to avoid masking bugs with silent retries.
 */
function isNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const networkErrorCodes = ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EPIPE']
  const code = (error as any)?.code
  if (code && networkErrorCodes.includes(code)) return true
  const networkErrorNames = ['FetchError', 'NetworkError', 'AbortError']
  return networkErrorNames.includes(error.name)
}

/**
 * Wraps an async function with retry logic using exponential backoff and jitter.
 * Respects Retry-After headers from LLM providers on 429 and 503 responses.
 * Only retries on known transient errors — never on JS runtime errors or user errors (4xx).
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const maxRetries = options.maxRetries ?? RETRY_DEFAULTS.MAX_RETRIES
  const initialDelayMs = options.initialDelayMs ?? RETRY_DEFAULTS.INITIAL_DELAY_MS
  const maxDelayMs = options.maxDelayMs ?? RETRY_DEFAULTS.MAX_DELAY_MS
  const retryableStatusCodes = options.retryableStatusCodes ?? RETRY_DEFAULTS.RETRYABLE_STATUS_CODES

  let lastError: unknown

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error

      if (attempt === maxRetries) break

      const status = (error as any)?.status ?? (error as any)?.statusCode ?? null
      const responseHeaders: Headers | null = (error as any)?.headers ?? null

      // Only retry known transient HTTP codes or recognised network errors
      // Statusless JS errors (TypeError, RangeError, etc.) are NOT retried
      const isRetryable =
        status !== null
          ? retryableStatusCodes.includes(status)
          : isNetworkError(error)

      if (!isRetryable) {
        logger.warn('Non-retryable error, aborting retry loop', { status, attempt })
        throw error
      }

      // Respect Retry-After header for both 429 and 503 (RFC 7231 §7.1.3)
      let delayMs: number
      if (responseHeaders && (status === 429 || status === 503 || status === 529)) {
        const retryAfterMs = parseRetryAfterHeader(responseHeaders)
        delayMs = retryAfterMs !== null ? Math.min(retryAfterMs, maxDelayMs) : calculateBackoffDelay(attempt, initialDelayMs, maxDelayMs)
      } else {
        delayMs = calculateBackoffDelay(attempt, initialDelayMs, maxDelayMs)
      }

      logger.warn('Retrying after transient LLM provider error', {
        attempt: attempt + 1,
        maxRetries,
        status,
        delayMs,
      })

      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }

  throw lastError
}
