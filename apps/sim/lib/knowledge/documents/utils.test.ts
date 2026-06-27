/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockSecureFetchWithValidation } = vi.hoisted(() => ({
  mockSecureFetchWithValidation: vi.fn(),
}))

vi.mock('@/lib/core/security/input-validation.server', () => ({
  secureFetchWithValidation: mockSecureFetchWithValidation,
}))

import { secureFetchWithRetry } from './secure-fetch.server'
import { isRetryableError } from './utils'

/** Builds a minimal SecureFetchResponse-shaped object for tests. */
function fakeResponse(
  status: number,
  options: { headers?: Record<string, string>; body?: string } = {}
) {
  const headers = options.headers ?? {}
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: `status-${status}`,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    body: null,
    text: async () => options.body ?? '',
    json: async () => JSON.parse(options.body ?? '{}'),
    arrayBuffer: async () => new ArrayBuffer(0),
  }
}

const FAST_RETRY = { initialDelayMs: 1, maxDelayMs: 2, maxRetries: 3 }

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

    it.concurrent('returns true for a transient DNS resolution failure', () => {
      expect(isRetryableError(new Error('url hostname could not be resolved'))).toBe(true)
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

    it.concurrent('returns false for the deterministic blocked-IP SSRF rejection', () => {
      expect(isRetryableError(new Error('url resolves to a blocked IP address'))).toBe(false)
    })
  })
})

describe('secureFetchWithRetry', () => {
  beforeEach(() => {
    mockSecureFetchWithValidation.mockReset()
  })

  it('routes the request through secureFetchWithValidation and returns the response', async () => {
    mockSecureFetchWithValidation.mockResolvedValue(fakeResponse(200, { body: 'ok' }))

    const response = await secureFetchWithRetry('https://example.com/api', {
      method: 'GET',
      headers: { Accept: 'application/json' },
    })

    expect(response.status).toBe(200)
    expect(mockSecureFetchWithValidation).toHaveBeenCalledTimes(1)
    const [url, options, paramName] = mockSecureFetchWithValidation.mock.calls[0]
    expect(url).toBe('https://example.com/api')
    expect(options).toMatchObject({ method: 'GET', headers: { Accept: 'application/json' } })
    expect(paramName).toBe('url')
  })

  it('propagates SSRF validation failures without retrying', async () => {
    mockSecureFetchWithValidation.mockRejectedValue(
      new Error('url resolves to a blocked IP address')
    )

    await expect(
      secureFetchWithRetry('https://attacker.test', { method: 'GET' }, FAST_RETRY)
    ).rejects.toThrow('blocked IP address')

    expect(mockSecureFetchWithValidation).toHaveBeenCalledTimes(1)
  })

  it('retries on a retryable status (503) and succeeds', async () => {
    mockSecureFetchWithValidation
      .mockResolvedValueOnce(fakeResponse(503, { body: 'try later' }))
      .mockResolvedValueOnce(fakeResponse(200, { body: 'ok' }))

    const response = await secureFetchWithRetry(
      'https://example.com/api',
      { method: 'GET' },
      FAST_RETRY
    )

    expect(response.status).toBe(200)
    expect(mockSecureFetchWithValidation).toHaveBeenCalledTimes(2)
  })

  it('does not retry a non-retryable status (404) and returns it to the caller', async () => {
    mockSecureFetchWithValidation.mockResolvedValue(fakeResponse(404, { body: 'missing' }))

    const response = await secureFetchWithRetry(
      'https://example.com/api',
      { method: 'GET' },
      FAST_RETRY
    )

    expect(response.status).toBe(404)
    expect(mockSecureFetchWithValidation).toHaveBeenCalledTimes(1)
  })

  it('forwards allowHttp / timeout / maxResponseBytes to the pinned fetch', async () => {
    mockSecureFetchWithValidation.mockResolvedValue(fakeResponse(200))

    await secureFetchWithRetry(
      'http://localhost:9000',
      { method: 'GET' },
      { allowHttp: true, timeout: 5000, maxResponseBytes: 1024, ...FAST_RETRY }
    )

    const [, options] = mockSecureFetchWithValidation.mock.calls[0]
    expect(options).toMatchObject({ allowHttp: true, timeout: 5000, maxResponseBytes: 1024 })
  })

  it('honors Retry-After (seconds) on a 429 before retrying', async () => {
    mockSecureFetchWithValidation
      .mockResolvedValueOnce(fakeResponse(429, { headers: { 'retry-after': '0' } }))
      .mockResolvedValueOnce(fakeResponse(200))

    const response = await secureFetchWithRetry(
      'https://example.com/api',
      { method: 'GET' },
      FAST_RETRY
    )

    expect(response.status).toBe(200)
    expect(mockSecureFetchWithValidation).toHaveBeenCalledTimes(2)
  })
})
