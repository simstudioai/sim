import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'

const logger = createLogger('RetryUtils')

interface HTTPError extends Error {
  status?: number
  statusText?: string
  retryAfterMs?: number
}

type RetryableError = HTTPError | Error | { status?: number; message?: string }

export interface RetryOptions {
  maxRetries?: number
  initialDelayMs?: number
  maxDelayMs?: number
  backoffMultiplier?: number
  retryCondition?: (error: unknown) => boolean
}

export interface RetryResult<T> {
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
 * Default retry condition for rate limiting errors
 */
export function isRetryableError(error: unknown): boolean {
  if (!isRetryableErrorType(error)) return false

  // Check for rate limiting status codes
  if (
    hasStatus(error) &&
    (error.status === 429 || error.status === 502 || error.status === 503 || error.status === 504)
  ) {
    return true
  }

  // Check for network-level errors (DNS, connection, timeout)
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
  ]

  if (networkKeywords.some((keyword) => lowerMessage.includes(keyword))) {
    return true
  }

  // Check for rate limiting in error messages
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

      // If this is the last attempt, throw the error
      if (attempt === maxRetries) {
        logger.error(`Operation failed after ${maxRetries + 1} attempts`, { error })
        throw lastError
      }

      // Check if error is retryable
      if (!retryCondition(error as RetryableError)) {
        logger.warn('Error is not retryable, throwing immediately', { error })
        throw lastError
      }

      // Use Retry-After if the server told us how long to wait, otherwise exponential backoff.
      // Cap Retry-After at maxDelayMs to bound total retry duration (matches Google Cloud SDK behavior).
      const retryAfterMs = (lastError as HTTPError)?.retryAfterMs
      const cappedRetryAfter = retryAfterMs ? Math.min(retryAfterMs, maxDelayMs) : undefined

      if (retryAfterMs && retryAfterMs > maxDelayMs) {
        logger.warn(
          `Retry-After ${retryAfterMs}ms exceeds maxDelayMs ${maxDelayMs}ms — capping to ${maxDelayMs}ms`
        )
      }

      const jitter = Math.random() * 0.1 * delay
      const actualDelay = cappedRetryAfter ?? Math.min(delay + jitter, maxDelayMs)

      logger.info(
        `Retrying in ${Math.round(actualDelay)}ms (attempt ${attempt + 1}/${maxRetries + 1})${cappedRetryAfter ? ' (Retry-After)' : ''}`
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

    // If response is not ok and status indicates rate limiting, throw an error
    if (!response.ok && isRetryableError({ status: response.status })) {
      const errorText = await response.text()
      const error: HTTPError = new Error(
        `HTTP ${response.status}: ${response.statusText} - ${errorText}`
      )
      error.status = response.status
      error.statusText = response.statusText

      // Pass Retry-After to the retry loop so it replaces exponential backoff
      const retryAfter = response.headers.get('Retry-After')
      if (retryAfter) {
        const waitMs = Number.isNaN(Number(retryAfter))
          ? Math.max(0, new Date(retryAfter).getTime() - Date.now())
          : Number(retryAfter) * 1000
        if (waitMs > 0) {
          error.retryAfterMs = waitMs
        }
      }

      throw error
    }

    return response
  }, retryOptions)
}
