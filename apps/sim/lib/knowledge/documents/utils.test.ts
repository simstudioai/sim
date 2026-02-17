/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@sim/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

import { isRetryableError } from './utils'

describe('isRetryableError', () => {
  describe('retryable status codes', () => {
    it.concurrent('returns true for 429 on Error with status', () => {
      const error = Object.assign(new Error('Too Many Requests'), { status: 429 })
      expect(isRetryableError(error)).toBe(true)
    })

    it.concurrent('returns true for 502 on Error with status', () => {
      const error = Object.assign(new Error('Bad Gateway'), { status: 502 })
      expect(isRetryableError(error)).toBe(true)
    })

    it.concurrent('returns true for 503 on Error with status', () => {
      const error = Object.assign(new Error('Service Unavailable'), { status: 503 })
      expect(isRetryableError(error)).toBe(true)
    })

    it.concurrent('returns true for 504 on Error with status', () => {
      const error = Object.assign(new Error('Gateway Timeout'), { status: 504 })
      expect(isRetryableError(error)).toBe(true)
    })

    it.concurrent('returns true for plain object with status 429', () => {
      expect(isRetryableError({ status: 429 })).toBe(true)
    })

    it.concurrent('returns true for plain object with status 502', () => {
      expect(isRetryableError({ status: 502 })).toBe(true)
    })

    it.concurrent('returns true for plain object with status 503', () => {
      expect(isRetryableError({ status: 503 })).toBe(true)
    })

    it.concurrent('returns true for plain object with status 504', () => {
      expect(isRetryableError({ status: 504 })).toBe(true)
    })
  })

  describe('non-retryable status codes', () => {
    it.concurrent('returns false for 400', () => {
      const error = Object.assign(new Error('Bad Request'), { status: 400 })
      expect(isRetryableError(error)).toBe(false)
    })

    it.concurrent('returns false for 401', () => {
      const error = Object.assign(new Error('Unauthorized'), { status: 401 })
      expect(isRetryableError(error)).toBe(false)
    })

    it.concurrent('returns false for 403', () => {
      const error = Object.assign(new Error('Forbidden'), { status: 403 })
      expect(isRetryableError(error)).toBe(false)
    })

    it.concurrent('returns false for 404', () => {
      const error = Object.assign(new Error('Not Found'), { status: 404 })
      expect(isRetryableError(error)).toBe(false)
    })

    it.concurrent('returns false for 500', () => {
      const error = Object.assign(new Error('Internal Server Error'), { status: 500 })
      expect(isRetryableError(error)).toBe(false)
    })
  })

  describe('retryable error messages', () => {
    it.concurrent('returns true for "rate limit" in message', () => {
      expect(isRetryableError(new Error('You have hit the rate limit'))).toBe(true)
    })

    it.concurrent('returns true for "rate_limit" in message', () => {
      expect(isRetryableError(new Error('rate_limit_exceeded'))).toBe(true)
    })

    it.concurrent('returns true for "too many requests" in message', () => {
      expect(isRetryableError(new Error('too many requests, slow down'))).toBe(true)
    })

    it.concurrent('returns true for "quota exceeded" in message', () => {
      expect(isRetryableError(new Error('API quota exceeded'))).toBe(true)
    })

    it.concurrent('returns true for "throttled" in message', () => {
      expect(isRetryableError(new Error('Request was throttled'))).toBe(true)
    })

    it.concurrent('returns true for "retry after" in message', () => {
      expect(isRetryableError(new Error('Please retry after 60 seconds'))).toBe(true)
    })

    it.concurrent('returns true for "temporarily unavailable" in message', () => {
      expect(isRetryableError(new Error('Service is temporarily unavailable'))).toBe(true)
    })

    it.concurrent('returns true for "service unavailable" in message', () => {
      expect(isRetryableError(new Error('The service unavailable right now'))).toBe(true)
    })
  })

  describe('case insensitivity', () => {
    it.concurrent('matches "Rate Limit" with mixed case', () => {
      expect(isRetryableError(new Error('Rate Limit Exceeded'))).toBe(true)
    })

    it.concurrent('matches "THROTTLED" in uppercase', () => {
      expect(isRetryableError(new Error('REQUEST THROTTLED'))).toBe(true)
    })

    it.concurrent('matches "Too Many Requests" in title case', () => {
      expect(isRetryableError(new Error('Too Many Requests'))).toBe(true)
    })
  })

  describe('null, undefined, and non-error inputs', () => {
    it.concurrent('returns false for null', () => {
      expect(isRetryableError(null)).toBe(false)
    })

    it.concurrent('returns false for undefined', () => {
      expect(isRetryableError(undefined)).toBe(false)
    })

    it.concurrent('returns false for empty string', () => {
      expect(isRetryableError('')).toBe(false)
    })

    it.concurrent('returns false for a number', () => {
      expect(isRetryableError(42)).toBe(false)
    })
  })

  describe('non-retryable errors', () => {
    it.concurrent('returns false for Error with no status and unrelated message', () => {
      expect(isRetryableError(new Error('Something went wrong'))).toBe(false)
    })

    it.concurrent('returns false for plain object with only non-retryable status', () => {
      expect(isRetryableError({ status: 404 })).toBe(false)
    })

    it.concurrent('returns false for plain object with non-retryable status and no message', () => {
      expect(isRetryableError({ status: 500 })).toBe(false)
    })
  })
})
