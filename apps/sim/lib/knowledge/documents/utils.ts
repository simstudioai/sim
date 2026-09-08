import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { interruptibleSleep } from '@sim/utils/helpers'
import { randomFloat } from '@sim/utils/random'
import { parseRetryAfter } from '@sim/utils/retry'
import { truncate } from '@sim/utils/string'
import { redactSensitiveValues } from '@/lib/core/security/redaction'
import {
  DEFAULT_MAX_ERROR_BODY_BYTES,
  isPayloadSizeLimitError,
  readResponseTextWithLimit,
} from '@/lib/core/utils/stream-limits'

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
  /** Provider-normalized signal for throttles that do not carry standard HTTP evidence. */
  rateLimited?: boolean
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
  /** Provider transport hooks run for every attempt, including retries and streamed responses. */
  fetcher?: typeof fetch
  /** Cancels the current retry cycle, including waits between attempts. */
  signal?: AbortSignal
  maxRetries?: number
  initialDelayMs?: number
  maxDelayMs?: number
  /** Total wall-clock budget for admission, attempts, response bodies, and retry waits. */
  retryBudgetMs?: number
  /** Longest individual server-stated wait this operation will admit. */
  maxRetryAfterMs?: number
  backoffMultiplier?: number
  retryCondition?: (error: unknown) => boolean
}

const MAX_HTTP_ERROR_DIAGNOSTIC_CHARS = 2000
const HTTP_ERROR_BODY_OMITTED = '[response body omitted]'
const DEFAULT_FETCH_RETRY_BUDGET_MS = 150_000

/**
 * Reads an upstream error body without allowing a provider or proxy error page
 * to become an unbounded task error, log entry, or Trigger output. The HTTP
 * status remains the retry signal when the body exceeds the byte ceiling.
 */
export async function readBoundedHttpErrorBody(response: {
  headers?: { get(name: string): string | null }
  body?: ReadableStream<Uint8Array> | null
  arrayBuffer?: () => Promise<ArrayBuffer>
  text?: () => Promise<string>
}): Promise<string> {
  const payload = await readBoundedHttpErrorPayload(response)
  if (payload.ok) {
    return HTTP_ERROR_BODY_OMITTED
  }

  return payload.reason === 'too_large'
    ? `[response body omitted: exceeded ${DEFAULT_MAX_ERROR_BODY_BYTES} bytes]`
    : '[response body unavailable]'
}

export type BoundedHttpErrorPayload =
  | { ok: true; body: string }
  | { ok: false; reason: 'too_large' }
  | { ok: false; reason: 'unavailable' }

/**
 * Reads a byte-bounded upstream error payload for structured parsing. The raw
 * value may contain secrets and must never be logged or included in an error;
 * callers must project and sanitize the parsed fields they retain.
 */
export async function readBoundedHttpErrorPayload(response: {
  headers?: { get(name: string): string | null }
  body?: ReadableStream<Uint8Array> | null
  arrayBuffer?: () => Promise<ArrayBuffer>
  text?: () => Promise<string>
}): Promise<BoundedHttpErrorPayload> {
  try {
    return {
      ok: true,
      body: await readResponseTextWithLimit(response, {
        maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
        label: 'Upstream HTTP error response',
      }),
    }
  } catch (error) {
    if (
      isPayloadSizeLimitError(error) &&
      error.observedBytes !== undefined &&
      error.observedBytes > error.maxBytes
    ) {
      return { ok: false, reason: 'too_large' }
    }
    return { ok: false, reason: 'unavailable' }
  }
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
 * Reads a validated provider retry delay from an error or one of its causes.
 *
 * The HTTP retry layer attaches this value when a provider supplies
 * `Retry-After` or an exhausted-quota reset header. Keeping the accessor here
 * lets longer-lived schedulers honor the same evidence without depending on a
 * concrete error class or parsing a diagnostic message.
 */
export function getRetryAfterMs(error: unknown): number | undefined {
  const seen = new Set<unknown>()
  let current = error

  while (current instanceof Error && !seen.has(current) && seen.size < 10) {
    seen.add(current)
    const retryAfterMs = (current as HTTPError).retryAfterMs
    if (typeof retryAfterMs === 'number' && Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
      return retryAfterMs
    }
    current = current.cause
  }

  return undefined
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

/**
 * Reports whether an error or one of its causes is a structured HTTP rate-limit
 * rejection. A bare 403 is intentionally excluded because it normally means the
 * caller lacks access; GitHub identifies the rate-limit form through response
 * headers, while 429 is unambiguous on its own.
 */
export function isRateLimitError(error: unknown): boolean {
  const seen = new Set<unknown>()
  let current = error

  while (isRetryableErrorType(current) && !seen.has(current) && seen.size < 10) {
    seen.add(current)
    if ((current as HTTPError).rateLimited === true) return true
    if (
      hasStatus(current) &&
      (current.status === 429 ||
        (current.status === 403 && hasRateLimitEvidence(readHeaders(current))))
    ) {
      return true
    }
    current = current instanceof Error ? current.cause : undefined
  }

  return false
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
 * until the end of the hourly window instead of climbing the backoff ladder.
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

interface RetryableHttpResponse {
  status: number
  headers: { get(name: string): string | null }
  body?: ReadableStream<Uint8Array> | null
  arrayBuffer?: () => Promise<ArrayBuffer>
  text?: () => Promise<string>
}

/** Releases a response stream when its provider-controlled body is intentionally omitted. */
async function cancelHttpResponseBody(response: RetryableHttpResponse): Promise<void> {
  if (!response.body) return
  try {
    await response.body.cancel()
  } catch {
    return
  }
}

/**
 * Builds the bounded error shared by direct and SSRF-safe connector fetches.
 * Rate-limit responses are named from trusted status/header evidence while all
 * provider-controlled bodies remain omitted.
 */
export async function createRetryableHttpError(
  response: RetryableHttpResponse
): Promise<HTTPError> {
  const rateLimited =
    response.status === 429 || (response.status === 403 && hasRateLimitEvidence(response.headers))
  if (rateLimited) {
    await cancelHttpResponseBody(response)
  }
  const diagnostic = rateLimited
    ? 'upstream rate limit exceeded'
    : await readBoundedHttpErrorBody(response)
  const error: HTTPError = new Error(`HTTP ${response.status} - ${diagnostic}`)
  error.status = response.status
  attachRetryHeaders(error, response.headers)

  const waitMs = resolveRetryDelayMs(response.headers)
  if (waitMs !== undefined) {
    error.retryAfterMs = waitMs
  }

  return error
}

/**
 * Default retry condition for rate limiting errors
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof Error && 'retryable' in error && error.retryable === false) return false
  if (!isRetryableErrorType(error)) return false

  /**
   * Retryable status codes. Cloudflare documents 520 as an unexpected origin
   * response and 522 as an origin connection timeout; both are transient edge
   * failures. 529 is not an IANA-registered status, but Notion documents it as
   * `service_overload` — "Notion is temporarily overloaded.
   * Respect the `Retry-After` response header and try again later" — and says
   * to "retry it the same way as a 429". Without it every Notion call fails
   * hard the moment their API sheds load.
   */
  if (
    hasStatus(error) &&
    (error.status === 429 ||
      error.status === 520 ||
      error.status === 522 ||
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
  operation: (signal: AbortSignal, deadlineAt: number) => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = 5,
    initialDelayMs = 1000,
    maxDelayMs = 30000,
    retryBudgetMs,
    backoffMultiplier = 2,
    retryCondition = isRetryableError,
    signal,
  } = options
  const maxRetryAfterMs = options.maxRetryAfterMs ?? retryBudgetMs ?? maxDelayMs

  if (!Number.isSafeInteger(maxRetries) || maxRetries < 0) {
    throw new Error('Retry maxRetries must be a non-negative safe integer')
  }
  for (const [name, value] of [
    ['initialDelayMs', initialDelayMs],
    ['maxDelayMs', maxDelayMs],
    ['maxRetryAfterMs', maxRetryAfterMs],
    ...(retryBudgetMs === undefined ? [] : [['retryBudgetMs', retryBudgetMs] as const]),
  ] as const) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`Retry ${name} must be a finite non-negative number`)
    }
  }
  if (!Number.isFinite(backoffMultiplier) || backoffMultiplier <= 0) {
    throw new Error('Retry backoffMultiplier must be a finite positive number')
  }
  const effectiveRetryBudgetMs = retryBudgetMs ?? maxRetries * Math.max(maxDelayMs, maxRetryAfterMs)
  const retryDeadlineMs = Date.now() + effectiveRetryBudgetMs

  const controller = new AbortController()
  const operationSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
  const timeout =
    retryBudgetMs === undefined
      ? undefined
      : setTimeout(
          () =>
            controller.abort(
              new DOMException('Provider operation exceeded its retry budget', 'TimeoutError')
            ),
          effectiveRetryBudgetMs
        )
  try {
    let lastError: Error | undefined
    let delay = initialDelayMs

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      operationSignal.throwIfAborted()
      try {
        logger.debug(`Executing operation attempt ${attempt + 1}/${maxRetries + 1}`)
        const result = await new Promise<T>((resolve, reject) => {
          const onAbort = () => {
            cleanup()
            reject(operationSignal.reason)
          }
          const cleanup = () => operationSignal.removeEventListener('abort', onAbort)
          operationSignal.addEventListener('abort', onAbort, { once: true })
          Promise.resolve()
            .then(() => {
              operationSignal.throwIfAborted()
              return operation(operationSignal, retryDeadlineMs)
            })
            .then(
              (value) => {
                cleanup()
                resolve(value)
              },
              (error: unknown) => {
                cleanup()
                reject(error)
              }
            )
        })
        operationSignal.throwIfAborted()

        if (attempt > 0) {
          logger.info(`Operation succeeded after ${attempt + 1} attempts`)
        }

        return result
      } catch (error) {
        operationSignal.throwIfAborted()
        lastError = toError(error)
        const retryableError = error as RetryableError
        const safeError = {
          error: truncate(
            redactSensitiveValues(lastError.message),
            MAX_HTTP_ERROR_DIAGNOSTIC_CHARS
          ),
          ...(hasStatus(retryableError) ? { status: retryableError.status } : {}),
        }
        logger.warn(`Operation failed on attempt ${attempt + 1}`, safeError)

        if (attempt === maxRetries) {
          logger.error(`Operation failed after ${maxRetries + 1} attempts`, safeError)
          throw lastError
        }

        if (!retryCondition(error as RetryableError)) {
          logger.warn('Error is not retryable, throwing immediately', safeError)
          throw lastError
        }

        /**
         * Use the server-stated wait (Retry-After, or the rate-limit reset
         * header) when present, otherwise exponential backoff.
         *
         * A server-stated wait is authoritative when it fits inside the remaining
         * operation budget. It is never shortened into an early request that the
         * provider explicitly told us not to make.
         */
        const retryAfterMs = (lastError as HTTPError)?.retryAfterMs

        const remainingBudgetMs = Math.max(0, retryDeadlineMs - Date.now())
        if (retryAfterMs && retryAfterMs > maxRetryAfterMs) {
          logger.warn(
            `Server-stated retry wait ${retryAfterMs}ms exceeds per-wait ceiling ${maxRetryAfterMs}ms — ending this retry cycle`
          )
          throw lastError
        }
        if (retryAfterMs && retryAfterMs > remainingBudgetMs) {
          logger.warn(
            `Server-stated retry wait ${retryAfterMs}ms exceeds remaining retry budget ${remainingBudgetMs}ms — ending this retry cycle`
          )
          throw lastError
        }

        const jitter = randomFloat() * 0.1 * delay
        const actualDelay = retryAfterMs ? retryAfterMs : Math.min(delay + jitter, maxDelayMs)

        if (actualDelay > remainingBudgetMs) {
          logger.warn(
            `Retry delay ${Math.round(actualDelay)}ms exceeds remaining retry budget ${Math.round(remainingBudgetMs)}ms — ending this retry cycle`
          )
          throw lastError
        }

        logger.info(
          `Retrying in ${Math.round(actualDelay)}ms (attempt ${attempt + 1}/${maxRetries + 1})${retryAfterMs ? ' (server-stated)' : ''}`
        )

        await interruptibleSleep(actualDelay, operationSignal)
        operationSignal.throwIfAborted()

        // Exponential backoff (skip if we used Retry-After)
        if (!retryAfterMs) {
          delay = Math.min(delay * backoffMultiplier, maxDelayMs)
        }
      }
    }

    throw lastError || new Error('Retry operation failed')
  } finally {
    clearTimeout(timeout)
  }
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
 * Bounds requests and response bodies within one retry budget.
 */
export async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  retryOptions: RetryOptions = {}
): Promise<Response> {
  const callerSignal = options.signal
    ? retryOptions.signal
      ? AbortSignal.any([options.signal, retryOptions.signal])
      : options.signal
    : retryOptions.signal

  return retryWithExponentialBackoff(
    async (signal, deadlineAt) => {
      /** The fetch deadline stays active while callers consume the returned response body. */
      const requestSignal = AbortSignal.any([
        signal,
        AbortSignal.timeout(Math.max(0, Math.ceil(deadlineAt - Date.now()))),
      ])
      const response = await (retryOptions.fetcher ?? fetch)(url, {
        ...options,
        signal: requestSignal,
      })

      if (
        !response.ok &&
        isRetryableError({ status: response.status, headers: response.headers })
      ) {
        throw await createRetryableHttpError(response)
      }

      return response
    },
    {
      ...retryOptions,
      retryBudgetMs: retryOptions.retryBudgetMs ?? DEFAULT_FETCH_RETRY_BUDGET_MS,
      maxRetryAfterMs:
        retryOptions.maxRetryAfterMs ??
        retryOptions.retryBudgetMs ??
        retryOptions.maxDelayMs ??
        30_000,
      signal: callerSignal,
    }
  )
}
