import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('RetryUtils')

interface HTTPError extends Error {
  status?: number
  statusText?: string
}

type RetryableError = HTTPError | Error | { status?: number; message?: string }

export interface RetryOptions {
  maxRetries?: number
  initialDelayMs?: number
  maxDelayMs?: number
  backoffMultiplier?: number
  retryCondition?: (error: RetryableError) => boolean
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

/**
 * Default retry condition for rate limiting errors
 */
export function isRetryableError(error: RetryableError): boolean {
  if (!error) return false

  // Check for rate limiting status codes
  if (
    hasStatus(error) &&
    (error.status === 429 || error.status === 502 || error.status === 503 || error.status === 504)
  ) {
    return true
  }

  // Check for rate limiting in error messages
  const errorMessage = error.message || error.toString()
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

  return rateLimitKeywords.some((keyword) => errorMessage.toLowerCase().includes(keyword))
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
      lastError = error instanceof Error ? error : new Error(String(error))
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

      // Add jitter to prevent thundering herd
      const jitter = Math.random() * 0.1 * delay
      const actualDelay = Math.min(delay + jitter, maxDelayMs)

      logger.info(
        `Retrying in ${Math.round(actualDelay)}ms (attempt ${attempt + 1}/${maxRetries + 1})`
      )

      await new Promise((resolve) => setTimeout(resolve, actualDelay))

      // Exponential backoff
      delay = Math.min(delay * backoffMultiplier, maxDelayMs)
    }
  }

  throw lastError || new Error('Retry operation failed')
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
      throw error
    }

    return response
  }, retryOptions)
}
