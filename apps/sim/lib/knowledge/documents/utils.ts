import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { randomFloat } from '@sim/utils/random'
import { parseRetryAfter } from '@sim/utils/retry'

const logger = createLogger('RetryUtils')

/**
 * Minimal case-insensitive header reader. Satisfied by the DOM `Headers` class
 * and by the header bag on `SecureFetchResponse`, so retry evidence can be read
 * without depending on either concrete response type.
 */
export interface HeaderReader {
  get(name: string): string | null | undefined
}

export interface HTTPError extends Error {
  status?: number
  statusText?: string
  retryAfterMs?: number
  /**
   * Response headers carried onto the error so the retry loop can re-evaluate
   * rate-limit evidence (`isRetryableError` runs again on the thrown error).
   */
  headers?: HeaderReader
}

type RetryableError =
  | HTTPError
  | Error
  | { status?: number; message?: string; headers?: HeaderReader }

export interface RetryOptions {
  maxRetries?: number
  initialDelayMs?: number
  maxDelayMs?: number
  backoffMultiplier?: number
  retryCondition?: (error: unknown) => boolean
}

interface RetryResult<T> {
  success: boolean
  data?: T
  error?: Error
  attemptCount: number
}

function hasStatus(
  error: RetryableError
): error is HTTPError | { status?: number; message?: string } {
  return typeof error === 'object' && error !== null && 'status' in error
}

function isRetryableErrorType(error: unknown): error is RetryableError {
  if (!error) return false
  if (error instanceof Error) return true
  if (typeof error === 'object' && ('status' in error || 'message' in error)) return true
  return false
}

/**
 * Header names carrying the remaining-request count. GitHub spells it
 * `x-ratelimit-remaining`; X spells it `x-rate-limit-remaining`.
 */
const RATE_LIMIT_REMAINING_HEADERS = ['x-ratelimit-remaining', 'x-rate-limit-remaining'] as const

/**
 * Header names carrying the window-reset instant as UTC epoch seconds. GitHub
 * documents `x-ratelimit-reset` ("The time at which the current rate limit
 * window resets, in UTC epoch seconds"); X documents `x-rate-limit-reset` as a
 * Unix timestamp. The two spellings differ — both must be read.
 */
const RATE_LIMIT_RESET_HEADERS = ['x-ratelimit-reset', 'x-rate-limit-reset'] as const

/**
 * Upper bound on a reset-derived wait before the value is treated as bogus.
 * X documents windows of "15 minutes or 24 hours" and GitHub's primary window
 * is an hour, so anything past a day means the header was a delta, a
 * millisecond value, or otherwise not the documented epoch-seconds instant.
 */
const MAX_RATE_LIMIT_RESET_WINDOW_MS = 24 * 60 * 60 * 1000

function readHeaders(error: RetryableError): HeaderReader | undefined {
  if (typeof error !== 'object' || error === null || !('headers' in error)) return undefined
  const headers = (error as { headers?: unknown }).headers
  if (headers && typeof (headers as HeaderReader).get === 'function') {
    return headers as HeaderReader
  }
  return undefined
}

/**
 * Attaches response headers to a thrown error as a non-enumerable property, so
 * the retry loop can re-evaluate rate-limit evidence without the header bag
 * reaching a log line.
 *
 * `@sim/logger` copies an error's own *enumerable* properties into the formatted
 * output, and `SecureFetchHeaders` keeps its `Set-Cookie` values in an ordinary
 * array field, so a plain assignment prints the upstream response's cookies.
 * `readHeaders` uses `in`, which sees non-enumerable properties, so the retry
 * path is unaffected.
 */
export function attachRetryHeaders(error: HTTPError, headers: HeaderReader): void {
  Object.defineProperty(error, 'headers', {
    value: headers,
    enumerable: false,
    writable: true,
    configurable: true,
  })
}

/**
 * True when response headers positively identify a rate-limit rejection rather
 * than an authorization denial.
 *
 * GitHub returns "a `403` or `429` response" for both its primary and its
 * secondary rate limit, and directs clients to retry on exactly this evidence:
 * "If the `retry-after` response header is present, you should not retry your
 * request until after that many seconds has elapsed" and "If the
 * `x-ratelimit-remaining` header is `0`, you should not make another request
 * until after the time specified by the `x-ratelimit-reset` header."
 *
 * A bare 403 stays non-retryable — without one of these headers a 403 is an
 * ordinary authorization failure and retrying it is pointless.
 */
export function hasRateLimitEvidence(headers: HeaderReader | undefined): boolean {
  if (!headers) return false
  if (headers.get('retry-after')) return true
  return RATE_LIMIT_REMAINING_HEADERS.some((name) => headers.get(name) === '0')
}

function parseRateLimitResetMs(value: string, nowMs: number): number | undefined {
  const resetEpochSeconds = Number(value)
  if (!Number.isFinite(resetEpochSeconds) || resetEpochSeconds <= 0) return undefined
  const waitMs = resetEpochSeconds * 1000 - nowMs
  if (waitMs <= 0 || waitMs > MAX_RATE_LIMIT_RESET_WINDOW_MS) return undefined
  return waitMs
}

/**
 * Resolves how long a rate-limited caller must wait, in ms, from response
 * headers. Prefers `Retry-After` (seconds or HTTP-date), then falls back to the
 * epoch-seconds reset header.
 *
 * The fallback exists because X does not send `Retry-After`: its documented
 * rate-limit headers are `x-rate-limit-limit`, `x-rate-limit-remaining`, and
 * `x-rate-limit-reset` (a Unix timestamp) only. GitHub sends `retry-after` on
 * secondary limits but signals the primary limit through `x-ratelimit-reset`
 * alone.
 *
 * The reset fallback applies only once {@link hasRateLimitEvidence} holds.
 * GitHub and X stamp their rate-limit headers on *every* response, so an
 * ungated fallback would turn a transient 502 — quota untouched — into a wait
 * until the end of the hourly window, which the retry loop then clamps to a
 * flat `maxDelayMs` on every attempt instead of climbing the backoff ladder.
 * Gating also matches GitHub's own instruction: "If the `x-ratelimit-remaining`
 * header is `0`, you should not make another request until after the time
 * specified by the `x-ratelimit-reset` header."
 *
 * Returns undefined when no header yields a usable future instant, leaving the
 * caller on exponential backoff.
 */
export function resolveRetryDelayMs(
  headers: HeaderReader | undefined,
  nowMs: number = Date.now()
): number | undefined {
  if (!headers || !hasRateLimitEvidence(headers)) return undefined

  // Uncapped here on purpose: `retryWithExponentialBackoff` owns the clamp to
  // its own maxDelayMs, and the default 30s cap would silently truncate it.
  const retryAfterMs = parseRetryAfter(headers.get('retry-after') ?? null, Number.POSITIVE_INFINITY)
  if (retryAfterMs !== null && retryAfterMs > 0) return retryAfterMs

  for (const name of RATE_LIMIT_RESET_HEADERS) {
    const reset = headers.get(name)
    if (!reset) continue
    const waitMs = parseRateLimitResetMs(reset, nowMs)
    if (waitMs !== undefined) return waitMs
  }

  return undefined
}

/**
 * Default retry condition for rate limiting errors
 */
export function isRetryableError(error: unknown): boolean {
  if (!isRetryableErrorType(error)) return false

  /**
   * Retryable status codes. 529 is not an IANA-registered status, but Notion
   * documents it as `service_overload` — "Notion is temporarily overloaded.
   * Respect the `Retry-After` response header and try again later" — and says
   * to "retry it the same way as a 429". Without it every Notion call fails
   * hard the moment their API sheds load.
   */
  if (
    hasStatus(error) &&
    (error.status === 429 ||
      error.status === 502 ||
      error.status === 503 ||
      error.status === 504 ||
      error.status === 529)
  ) {
    return true
  }

  /**
   * A 403 is retryable only with positive rate-limit evidence in the response
   * headers. GitHub answers both its primary and secondary rate limits with
   * "a `403` or `429` response", so a rate-limit 403 would otherwise be treated
   * as a hard auth failure. Retrying 403 unconditionally would be wrong — 403
   * normally means authorization denied.
   */
  if (hasStatus(error) && error.status === 403 && hasRateLimitEvidence(readHeaders(error))) {
    return true
  }

  const errorMessage = toError(error).message
  const lowerMessage = errorMessage.toLowerCase()

  const networkKeywords = [
    'fetch failed',
    'econnreset',
    'econnrefused',
    'etimedout',
    'enetunreach',
    'socket hang up',
    'network error',
    // Transient DNS resolution failure surfaced by secureFetchWithValidation
    // before the request is made. The deterministic "resolves to a blocked IP
    // address" security rejection is a distinct message and stays non-retryable.
    'could not be resolved',
  ]

  if (networkKeywords.some((keyword) => lowerMessage.includes(keyword))) {
    return true
  }

  const rateLimitKeywords = [
    'rate limit',
    'rate_limit',
    'too many requests',
    'quota exceeded',
    'throttled',
    'retry after',
    'temporarily unavailable',
    'service unavailable',
  ]

  return rateLimitKeywords.some((keyword) => lowerMessage.includes(keyword))
}

/**
 * Executes a function with exponential backoff retry logic
 */
export async function retryWithExponentialBackoff<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = 5,
    initialDelayMs = 1000,
    maxDelayMs = 30000,
    backoffMultiplier = 2,
    retryCondition = isRetryableError,
  } = options

  let lastError: Error | undefined
  let delay = initialDelayMs

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      logger.debug(`Executing operation attempt ${attempt + 1}/${maxRetries + 1}`)
      const result = await operation()

      if (attempt > 0) {
        logger.info(`Operation succeeded after ${attempt + 1} attempts`)
      }

      return result
    } catch (error) {
      lastError = toError(error)
      logger.warn(`Operation failed on attempt ${attempt + 1}`, { error })

      if (attempt === maxRetries) {
        logger.error(`Operation failed after ${maxRetries + 1} attempts`, { error })
        throw lastError
      }

      if (!retryCondition(error as RetryableError)) {
        logger.warn('Error is not retryable, throwing immediately', { error })
        throw lastError
      }

      /**
       * Use the server-stated wait (Retry-After, or the rate-limit reset
       * header) when present, otherwise exponential backoff. The wait is capped
       * at maxDelayMs to bound total retry duration.
       *
       * Note the tradeoff the cap creates for long rate-limit windows: GitHub's
       * primary window is an hour and X's is 15 minutes, both far beyond the
       * 30s default, so every retry fires before the window reopens and the
       * attempts are spent for nothing. Raising the cap would instead stall a
       * sync for the full window. Neither provider documents a bound here, so
       * the existing conservative cap stands and the mismatch is logged.
       */
      const retryAfterMs = (lastError as HTTPError)?.retryAfterMs
      const cappedRetryAfter = retryAfterMs ? Math.min(retryAfterMs, maxDelayMs) : undefined

      if (retryAfterMs && retryAfterMs > maxDelayMs) {
        logger.warn(
          `Server-stated retry wait ${retryAfterMs}ms exceeds maxDelayMs ${maxDelayMs}ms — capping to ${maxDelayMs}ms; retries will fire before the rate-limit window reopens`
        )
      }

      const jitter = randomFloat() * 0.1 * delay
      const actualDelay = cappedRetryAfter ?? Math.min(delay + jitter, maxDelayMs)

      logger.info(
        `Retrying in ${Math.round(actualDelay)}ms (attempt ${attempt + 1}/${maxRetries + 1})${cappedRetryAfter ? ' (server-stated)' : ''}`
      )

      await sleep(actualDelay)

      // Exponential backoff (skip if we used Retry-After)
      if (!cappedRetryAfter) {
        delay = Math.min(delay * backoffMultiplier, maxDelayMs)
      }
    }
  }

  throw lastError || new Error('Retry operation failed')
}

/**
 * Tighter retry options for user-facing operations (e.g. validateConfig).
 * Caps total wait at ~7s instead of ~31s to avoid API route timeouts.
 */
export const VALIDATE_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 10000,
}

/**
 * Wrapper for fetch requests with retry logic
 */
export async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  retryOptions: RetryOptions = {}
): Promise<Response> {
  return retryWithExponentialBackoff(async () => {
    const response = await fetch(url, options)

    if (!response.ok && isRetryableError({ status: response.status, headers: response.headers })) {
      const errorText = await response.text()
      const error: HTTPError = new Error(
        `HTTP ${response.status}: ${response.statusText} - ${errorText}`
      )
      error.status = response.status
      error.statusText = response.statusText
      // The retry loop re-runs the retry condition against this error, so the
      // headers must travel with it or a rate-limit 403 would throw immediately.
      attachRetryHeaders(error, response.headers)

      // Pass the server-stated wait to the retry loop so it replaces exponential
      // backoff. Falls back to the epoch-seconds reset header when the provider
      // sends no Retry-After (X never does).
      const waitMs = resolveRetryDelayMs(response.headers)
      if (waitMs !== undefined) {
        error.retryAfterMs = waitMs
      }

      throw error
    }

    return response
  }, retryOptions)
}
