import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('RetryUtility')

export interface RetryOptions {
  /**
   * Maximum number of retry attempts
   * @default 3
   */
  maxAttempts?: number

  /**
   * Base delay in milliseconds before first retry
   * @default 1000
   */
  baseDelay?: number

  /**
   * Maximum delay in milliseconds (caps exponential backoff)
   * @default 10000
   */
  maxDelay?: number

  /**
   * HTTP status codes that should trigger a retry
   * @default [429, 500, 502, 503, 504]
   */
  retryableStatusCodes?: number[]

  /**
   * Callback invoked before each retry attempt
   */
  onRetry?: (attempt: number, error: any) => void
}

/**
 * Executes a fetch request with exponential backoff retry logic.
 *
 * Automatically retries on:
 * - Network errors
 * - Configurable HTTP status codes (default: 429, 500+)
 *
 * Uses exponential backoff:
 * - Attempt 1: baseDelay ms
 * - Attempt 2: baseDelay * 2 ms
 * - Attempt 3: baseDelay * 4 ms
 * - etc., up to maxDelay
 *
 * @param url URL to fetch
 * @param options Fetch options
 * @param retryConfig Retry configuration
 * @returns Fetch response
 * @throws Error if all retry attempts fail
 *
 * @example
 * ```ts
 * const response = await fetchWithRetry(
 *   'https://api.example.com/data',
 *   { headers: { Authorization: 'Bearer token' } },
 *   { maxAttempts: 3, baseDelay: 1000 }
 * )
 * ```
 */
export async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  retryConfig: RetryOptions = {}
): Promise<Response> {
  const {
    maxAttempts = 3,
    baseDelay = 1000,
    maxDelay = 10000,
    retryableStatusCodes = [429, 500, 502, 503, 504],
    onRetry,
  } = retryConfig

  let lastError: any

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(url, options)

      // Success - return immediately
      if (response.ok) {
        if (attempt > 1) {
          logger.info('Request succeeded after retry', { attempt, url })
        }
        return response
      }

      // Check if we should retry this status code
      const shouldRetry = retryableStatusCodes.includes(response.status)

      if (!shouldRetry || attempt === maxAttempts) {
        // Don't retry client errors (4xx except 429) or if out of attempts
        return response
      }

      // Clone response to read error details for logging
      const errorText = await response.clone().text()
      lastError = new Error(`HTTP ${response.status}: ${errorText}`)

      logger.warn('Request failed, will retry', {
        attempt,
        maxAttempts,
        status: response.status,
        url,
      })
    } catch (error: any) {
      lastError = error

      // Network errors are always retryable
      if (attempt === maxAttempts) {
        logger.error('Request failed after all retry attempts', {
          attempts: maxAttempts,
          error: error.message,
          url,
        })
        throw error
      }

      logger.warn('Network error, will retry', {
        attempt,
        maxAttempts,
        error: error.message,
        url,
      })
    }

    // Calculate delay with exponential backoff
    if (attempt < maxAttempts) {
      const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay)

      if (onRetry) {
        onRetry(attempt, lastError)
      }

      logger.debug('Waiting before retry', { delay, attempt })
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }

  // This should never be reached, but TypeScript needs it
  throw lastError || new Error('Request failed after retries')
}

/**
 * Parse error message from various response formats.
 *
 * Handles common API error patterns:
 * - { detail: "message" } (Replicate, FastAPI)
 * - { error: "message" } (Many REST APIs)
 * - { message: "message" } (Standard pattern)
 * - Plain text
 *
 * @param response Fetch response
 * @returns User-friendly error message
 */
export async function parseErrorMessage(response: Response): Promise<string> {
  try {
    const text = await response.text()

    try {
      const json = JSON.parse(text)
      return json.detail || json.error || json.message || `HTTP ${response.status}`
    } catch {
      // Not JSON, return text
      return text || `HTTP ${response.status}: ${response.statusText}`
    }
  } catch {
    return `HTTP ${response.status}: ${response.statusText}`
  }
}

/**
 * Create a user-friendly error message based on HTTP status code.
 *
 * Provides actionable guidance for common errors.
 *
 * @param status HTTP status code
 * @param rawMessage Raw error message from API
 * @param serviceName Optional service name for context (e.g., 'Replicate', 'OpenAI')
 * @returns User-friendly error message with guidance
 */
export function getUserFriendlyError(
  status: number,
  rawMessage: string,
  serviceName?: string
): string {
  const service = serviceName || 'API'

  switch (status) {
    case 400:
      return `Invalid request: ${rawMessage}`
    case 401:
      return `Invalid API token. ${rawMessage || 'Please check your credentials.'}`
    case 403:
      return `Access denied. ${rawMessage || 'Check your API token permissions.'}`
    case 404:
      return `Resource not found. ${rawMessage}`
    case 429:
      return `Rate limited. ${rawMessage || 'The request will automatically retry in a moment.'}`
    case 500:
    case 502:
    case 503:
    case 504:
      return `${service} server error. ${rawMessage || 'The request will automatically retry.'}`
    default:
      return rawMessage || `${service} returned HTTP ${status}`
  }
}
