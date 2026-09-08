/**
 * @vitest-environment node
 */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Agent, fetch as nativeFetch } from 'undici'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockSecureFetchWithValidation } = vi.hoisted(() => ({
  mockSecureFetchWithValidation: vi.fn(),
}))

vi.mock('@/lib/core/security/input-validation.server', () => ({
  secureFetchWithValidation: mockSecureFetchWithValidation,
}))

import { secureFetchWithRetry } from '@/lib/knowledge/documents/secure-fetch.server'
import {
  fetchWithRetry,
  getRetryAfterMs,
  type HTTPError,
  hasRateLimitEvidence,
  isRateLimitError,
  isRetryableError,
  readBoundedHttpErrorPayload,
  resolveRetryDelayMs,
  retryWithExponentialBackoff,
} from '@/lib/knowledge/documents/utils'

/** Case-insensitive header reader over a plain lowercase-keyed record. */
function headers(entries: Record<string, string>) {
  return { get: (name: string) => entries[name.toLowerCase()] ?? null }
}

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

const FAST_RETRY = { initialDelayMs: 1, maxDelayMs: 2, maxRetries: 3, retryBudgetMs: 1_000 }

describe('readBoundedHttpErrorPayload', () => {
  it('returns a typed failure and cancels a response body that exceeds 64KiB', async () => {
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(64 * 1024 + 1))
      },
      cancel() {
        cancelled = true
      },
    })

    const result = await readBoundedHttpErrorPayload(new Response(body))

    expect(result).toEqual({ ok: false, reason: 'too_large' })
    expect(cancelled).toBe(true)
  })

  it('reports an unreadable body as unavailable without observed size evidence', async () => {
    const result = await readBoundedHttpErrorPayload({
      body: null,
      headers: { get: () => null },
    })

    expect(result).toEqual({ ok: false, reason: 'unavailable' })
  })
})

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

    it.concurrent.each([520, 522])('returns true for transient Cloudflare status %i', (status) => {
      expect(isRetryableError({ status })).toBe(true)
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

    /** Notion's `service_overload`, which its docs say to "retry the same way as a 429". */
    it.concurrent('returns true for 529 on Error with status', () => {
      const error = Object.assign(new Error('service_overload'), { status: 529 })
      expect(isRetryableError(error)).toBe(true)
    })

    it.concurrent('returns true for plain object with status 529', () => {
      expect(isRetryableError({ status: 529 })).toBe(true)
    })

    it.concurrent('does not retry 500, which stays adjacent to 529 in the status list', () => {
      expect(isRetryableError({ status: 500 })).toBe(false)
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

  /**
   * GitHub answers both its primary and secondary rate limit with "a `403` or
   * `429` response", so a 403 carrying rate-limit headers must retry while a
   * bare authorization 403 must not.
   */
  describe('rate-limit 403', () => {
    it.concurrent('retries a 403 whose x-ratelimit-remaining is 0 (GitHub primary)', () => {
      expect(
        isRetryableError({
          status: 403,
          headers: headers({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '99999999999' }),
        })
      ).toBe(true)
    })

    it.concurrent('retries a 403 carrying retry-after (GitHub secondary)', () => {
      expect(isRetryableError({ status: 403, headers: headers({ 'retry-after': '60' }) })).toBe(
        true
      )
    })

    it.concurrent('retries a 403 whose x-rate-limit-remaining is 0 (X spelling)', () => {
      expect(
        isRetryableError({ status: 403, headers: headers({ 'x-rate-limit-remaining': '0' }) })
      ).toBe(true)
    })

    it.concurrent('does NOT retry a 403 with no headers at all', () => {
      expect(isRetryableError({ status: 403 })).toBe(false)
    })

    it.concurrent('does NOT retry a 403 whose quota is not exhausted', () => {
      expect(
        isRetryableError({
          status: 403,
          headers: headers({ 'x-ratelimit-remaining': '4821', 'x-ratelimit-limit': '5000' }),
        })
      ).toBe(false)
    })

    it.concurrent('does NOT retry an authorization 403 on an Error carrying headers', () => {
      const error = Object.assign(new Error('Resource not accessible by integration'), {
        status: 403,
        headers: headers({ 'x-ratelimit-remaining': '4999' }),
      })
      expect(isRetryableError(error)).toBe(false)
    })

    it.concurrent('does NOT retry a 401 even with an exhausted quota header', () => {
      expect(
        isRetryableError({ status: 401, headers: headers({ 'x-ratelimit-remaining': '0' }) })
      ).toBe(false)
    })
  })
})

describe('hasRateLimitEvidence', () => {
  it.concurrent('returns false for undefined headers', () => {
    expect(hasRateLimitEvidence(undefined)).toBe(false)
  })

  it.concurrent('returns false when no rate-limit headers are present', () => {
    expect(hasRateLimitEvidence(headers({ 'content-type': 'application/json' }))).toBe(false)
  })

  it.concurrent('returns true on retry-after alone', () => {
    expect(hasRateLimitEvidence(headers({ 'retry-after': '30' }))).toBe(true)
  })
})

describe('resolveRetryDelayMs', () => {
  const NOW = 1_700_000_000_000

  it.concurrent('prefers Retry-After seconds over the reset header', () => {
    const delay = resolveRetryDelayMs(
      headers({ 'retry-after': '30', 'x-ratelimit-reset': String(NOW / 1000 + 3600) }),
      NOW
    )
    expect(delay).toBe(30_000)
  })

  it.concurrent('parses a Retry-After HTTP-date', () => {
    const delay = resolveRetryDelayMs(
      headers({ 'retry-after': new Date(Date.now() + 60_000).toUTCString() })
    )
    expect(delay).toBeGreaterThan(50_000)
    expect(delay).toBeLessThanOrEqual(60_000)
  })

  /** GitHub: "The time at which the current rate limit window resets, in UTC epoch seconds". */
  it.concurrent('falls back to x-ratelimit-reset (GitHub) as epoch seconds', () => {
    const delay = resolveRetryDelayMs(
      headers({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(NOW / 1000 + 900) }),
      NOW
    )
    expect(delay).toBe(900_000)
  })

  /** X sends no Retry-After — x-rate-limit-reset is the only recovery signal. */
  it.concurrent('falls back to x-rate-limit-reset (X spelling) as epoch seconds', () => {
    const delay = resolveRetryDelayMs(
      headers({ 'x-rate-limit-remaining': '0', 'x-rate-limit-reset': String(NOW / 1000 + 900) }),
      NOW
    )
    expect(delay).toBe(900_000)
  })

  /**
   * GitHub and X stamp their rate-limit headers on every response. Without the
   * evidence gate a transient 502 would be handed the rest of the hourly window
   * as its wait instead of following the exponential backoff ladder.
   */
  it.concurrent('ignores a reset header when the quota is NOT exhausted', () => {
    expect(
      resolveRetryDelayMs(
        headers({
          'x-ratelimit-limit': '5000',
          'x-ratelimit-remaining': '4821',
          'x-ratelimit-reset': String(NOW / 1000 + 2400),
        }),
        NOW
      )
    ).toBeUndefined()
  })

  it.concurrent('returns undefined when no usable header is present', () => {
    expect(resolveRetryDelayMs(headers({}), NOW)).toBeUndefined()
    expect(resolveRetryDelayMs(undefined, NOW)).toBeUndefined()
  })

  it.concurrent('ignores a reset instant already in the past', () => {
    expect(
      resolveRetryDelayMs(
        headers({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(NOW / 1000 - 60) }),
        NOW
      )
    ).toBeUndefined()
  })

  it.concurrent('ignores a non-numeric or absurd reset value', () => {
    expect(
      resolveRetryDelayMs(
        headers({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': 'soon' }),
        NOW
      )
    ).toBeUndefined()
    // A millisecond value mistaken for epoch seconds would be ~54,000 years out.
    expect(
      resolveRetryDelayMs(
        headers({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(NOW) }),
        NOW
      )
    ).toBeUndefined()
  })

  it.concurrent('ignores a zero Retry-After and falls through to the reset header', () => {
    const delay = resolveRetryDelayMs(
      headers({ 'retry-after': '0', 'x-ratelimit-reset': String(NOW / 1000 + 120) }),
      NOW
    )
    expect(delay).toBe(120_000)
  })

  /** The 30s default cap in `parseRetryAfter` must not truncate the value here. */
  it.concurrent('does not truncate a long Retry-After — retry policy owns admission', () => {
    expect(resolveRetryDelayMs(headers({ 'retry-after': '900' }), NOW)).toBe(900_000)
  })
})

describe('fetchWithRetry rate-limit handling', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  /** Builds a Response-shaped object with real case-insensitive Headers. */
  function response(status: number, headerEntries: Record<string, string> = {}) {
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: `status-${status}`,
      headers: new Headers(headerEntries),
      text: async () => 'body',
    } as unknown as Response
  }

  it('bounds a stalled request when no retry options are supplied', async () => {
    vi.useFakeTimers()
    let requestSignal: AbortSignal | null | undefined
    let finishRequest: ((response: Response) => void) | undefined
    globalThis.fetch = vi.fn((_url, options) => {
      requestSignal = options?.signal
      return new Promise<Response>((resolve) => {
        finishRequest = resolve
      })
    })
    const result = fetchWithRetry('https://api.github.com/repos/example/private').catch(
      (error: unknown) => error
    )

    try {
      await vi.advanceTimersByTimeAsync(150_001)
      expect(requestSignal?.aborted).toBe(true)
      await expect(result).resolves.toMatchObject({ name: 'TimeoutError' })
    } finally {
      finishRequest?.(new Response(null, { status: 200 }))
      await result
    }
  })

  it('aborts the underlying fetch when the retry budget expires', async () => {
    vi.useFakeTimers()
    let requestSignal: AbortSignal | null | undefined
    let finishRequest: ((response: Response) => void) | undefined
    globalThis.fetch = vi.fn((_url, options) => {
      requestSignal = options?.signal
      return new Promise<Response>((resolve) => {
        finishRequest = resolve
      })
    })
    const result = fetchWithRetry(
      'https://api.github.com/repos/example/private',
      {},
      { retryBudgetMs: 100 }
    ).catch((error: unknown) => error)

    try {
      await vi.advanceTimersByTimeAsync(100)
      await expect(result).resolves.toMatchObject({ name: 'TimeoutError' })
      expect(requestSignal?.aborted).toBe(true)
    } finally {
      finishRequest?.(new Response(null, { status: 200 }))
      await result
    }
  })

  it('keeps the remaining deadline active while consuming a response body after a retry', async () => {
    vi.useFakeTimers()
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation((milliseconds) => {
      const controller = new AbortController()
      setTimeout(
        () => controller.abort(new DOMException('Request exceeded its deadline', 'TimeoutError')),
        milliseconds
      )
      return controller.signal
    })
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' })
      response.write('partial')
    })
    const dispatcher = new Agent()
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    globalThis.fetch = vi
      .fn(async (_url, options) => {
        return (await nativeFetch(url, {
          dispatcher,
          signal: options?.signal,
        })) as unknown as Response
      })
      .mockResolvedValueOnce(response(429, { 'retry-after': '0.06' }))

    try {
      const pending = fetchWithRetry(url, {}, { retryBudgetMs: 100 })
      await vi.advanceTimersByTimeAsync(60)
      const response = await pending
      const reader = response.body!.getReader()
      expect(new TextDecoder().decode((await reader.read()).value)).toBe('partial')
      const result = reader.read().catch((error: unknown) => error)

      expect(timeout).toHaveBeenNthCalledWith(1, 100)
      expect(timeout).toHaveBeenNthCalledWith(2, 40)
      await vi.advanceTimersByTimeAsync(40)
      await expect(result).resolves.toMatchObject({ name: 'TimeoutError' })
    } finally {
      await dispatcher.destroy()
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it.each(['request', 'retry'] as const)(
    'honors the %s signal when both callers supply cancellation',
    async (cancelledBy) => {
      vi.useFakeTimers()
      const requestController = new AbortController()
      const retryController = new AbortController()
      let requestSignal: AbortSignal | null | undefined
      globalThis.fetch = vi.fn((_url, options) => {
        requestSignal = options?.signal
        return new Promise<Response>((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), {
            once: true,
          })
        })
      })
      const result = fetchWithRetry(
        'https://api.github.com/repos/example/private',
        { signal: requestController.signal },
        { signal: retryController.signal }
      )
      const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' })
      await vi.advanceTimersByTimeAsync(0)

      const controller = cancelledBy === 'request' ? requestController : retryController
      controller.abort()

      await rejected
      expect(requestSignal?.aborted).toBe(true)
      expect(globalThis.fetch).toHaveBeenCalledOnce()
      expect(vi.getTimerCount()).toBe(0)
    }
  )

  it('cancels a provider retry wait from the request signal without another attempt', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    globalThis.fetch = vi.fn().mockResolvedValue(response(503))
    const result = fetchWithRetry('https://api.github.com/repos/example/private', {
      signal: controller.signal,
    })
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' })
    await vi.advanceTimersByTimeAsync(0)

    controller.abort()

    await rejected
    expect(globalThis.fetch).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('preserves the default retry-wait ceiling when adding a request deadline', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(response(429, { 'retry-after': '31' }))

    await expect(
      fetchWithRetry('https://api.github.com/repos/example/private')
    ).rejects.toMatchObject({
      status: 429,
      retryAfterMs: 31_000,
    })

    expect(globalThis.fetch).toHaveBeenCalledOnce()
  })

  it('retries a rate-limit 403 (x-ratelimit-remaining: 0) and succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response(403, {
          'x-ratelimit-remaining': '0',
          'retry-after': '0.001',
        })
      )
      .mockResolvedValueOnce(response(200))
    globalThis.fetch = fetchMock

    const result = await fetchWithRetry('https://api.github.com/repos', {}, FAST_RETRY)

    expect(result.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it.each([520, 522])('retries transient Cloudflare status %i and succeeds', async (status) => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(status))
      .mockResolvedValueOnce(response(200))
    globalThis.fetch = fetchMock

    const result = await fetchWithRetry('https://api.fireflies.ai/graphql', {}, FAST_RETRY)

    expect(result.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('bounds the provider body carried by a retry error', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('x'.repeat(70 * 1024), {
        status: 522,
        statusText: 'Connection timed out',
      })
    )
    globalThis.fetch = fetchMock

    const error = await fetchWithRetry(
      'https://api.fireflies.ai/graphql',
      {},
      {
        ...FAST_RETRY,
        maxRetries: 0,
      }
    ).then(
      () => undefined,
      (caught) => caught as Error
    )

    expect(error?.message).toContain('response body omitted')
    expect(error?.message.length).toBeLessThan(500)
  })

  it('omits a provider-controlled response body from the retry error', async () => {
    const providerControlledMarker = 'provider-controlled-response-marker'
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ diagnostic: providerControlledMarker }), {
        status: 522,
        statusText: `Connection timed out: ${providerControlledMarker}`,
      })
    )

    const error = await fetchWithRetry(
      'https://api.fireflies.ai/graphql',
      {},
      { ...FAST_RETRY, maxRetries: 0 }
    ).then(
      () => undefined,
      (caught) => caught as Error
    )

    expect(error?.message).toContain('[response body omitted]')
    expect(error?.message).not.toContain(providerControlledMarker)
  })

  it('does not retry an authorization 403 with quota remaining', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(403, { 'x-ratelimit-remaining': '4999' }))
    globalThis.fetch = fetchMock

    const result = await fetchWithRetry('https://api.github.com/repos', {}, FAST_RETRY)

    expect(result.status).toBe(403)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not retry GitHub before a reset beyond the operation budget', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response(403, {
          'x-ratelimit-remaining': '0',
          'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 900),
        })
      )
      .mockResolvedValueOnce(response(200))
    globalThis.fetch = fetchMock

    const error = await fetchWithRetry('https://api.github.com/repos', {}, FAST_RETRY).then(
      () => undefined,
      (caught) => caught as Error
    )

    expect(error?.message).toBe('HTTP 403 - upstream rate limit exceeded')
    expect(getRetryAfterMs(error)).toBeGreaterThan(899_000)
    expect(getRetryAfterMs(error)).toBeLessThanOrEqual(900_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('cancels an omitted rate-limit response body before throwing', async () => {
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true
      },
    })
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(body, {
        status: 429,
        headers: { 'retry-after': '900' },
      })
    )

    await expect(
      fetchWithRetry('https://api.github.com/repos', {}, { ...FAST_RETRY, maxRetries: 0 })
    ).rejects.toThrow('HTTP 429 - upstream rate limit exceeded')
    expect(cancelled).toBe(true)
  })

  it('waits until an admitted x-rate-limit-reset instant before retrying', async () => {
    vi.useFakeTimers()
    const now = 1_700_000_000_000
    vi.setSystemTime(now)
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response(429, {
          'x-rate-limit-remaining': '0',
          'x-rate-limit-reset': String(now / 1000 + 1),
        })
      )
      .mockResolvedValueOnce(response(200))
    globalThis.fetch = fetchMock

    const result = fetchWithRetry(
      'https://api.twitter.com/2/users',
      {},
      {
        maxRetries: 1,
        initialDelayMs: 1,
        maxDelayMs: 10,
        maxRetryAfterMs: 1_500,
        retryBudgetMs: 1_500,
      }
    )

    await vi.advanceTimersByTimeAsync(999)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    await expect(result).resolves.toMatchObject({ status: 200 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  /**
   * `@sim/logger` copies an error's own *enumerable* properties into its
   * formatted output, and the retry loop logs `{ error }` on every failed
   * attempt. `SecureFetchHeaders` keeps its `Set-Cookie` values in an ordinary
   * array field, so an enumerable `headers` prints the upstream response's
   * cookies. The retry path reads it via `in`, which sees it either way.
   */
  it('carries headers on the thrown error without exposing them to the logger', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(response(403, { 'retry-after': '0', 'x-ratelimit-remaining': '0' }))
    globalThis.fetch = fetchMock

    const error = await fetchWithRetry('https://api.github.com/repos', {}, FAST_RETRY).then(
      () => undefined,
      (e) => e as HTTPError
    )

    // Retried, so the headers really did reach the retry condition.
    expect(fetchMock).toHaveBeenCalledTimes(FAST_RETRY.maxRetries + 1)
    expect(error?.headers?.get('x-ratelimit-remaining')).toBe('0')
    expect(Object.keys(error as object)).not.toContain('headers')
  })
})

describe('getRetryAfterMs', () => {
  it('finds a validated retry delay through an error cause chain', () => {
    const providerError = Object.assign(new Error('rate limited'), { retryAfterMs: 45_000 })
    expect(getRetryAfterMs(new Error('connector failed', { cause: providerError }))).toBe(45_000)
  })

  it.each([undefined, null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY, '30000'])(
    'ignores an invalid retry delay: %s',
    (retryAfterMs) => {
      expect(getRetryAfterMs(Object.assign(new Error('invalid'), { retryAfterMs }))).toBeUndefined()
    }
  )
})

describe('isRateLimitError', () => {
  it('accepts a 429 without requiring response headers', () => {
    expect(isRateLimitError(Object.assign(new Error('throttled'), { status: 429 }))).toBe(true)
  })

  it('accepts a GitHub 403 only with structured rate-limit evidence', () => {
    expect(
      isRateLimitError(
        Object.assign(new Error('forbidden'), {
          status: 403,
          headers: headers({ 'x-ratelimit-remaining': '0' }),
        })
      )
    ).toBe(true)
    expect(isRateLimitError(Object.assign(new Error('forbidden'), { status: 403 }))).toBe(false)
  })

  it('finds a structured rate-limit rejection through an error cause chain', () => {
    const providerError = Object.assign(new Error('throttled'), { status: 429 })
    expect(isRateLimitError(new Error('hydration failed', { cause: providerError }))).toBe(true)
  })

  it('accepts a provider-normalized throttle without HTTP rate-limit headers', () => {
    expect(
      isRateLimitError(
        Object.assign(new Error('Google Drive API request failed with HTTP 403'), {
          status: 403,
          rateLimited: true,
        })
      )
    ).toBe(true)
  })

  it('does not classify retryable text or transient HTTP failures as provider throttling', () => {
    expect(isRateLimitError(new Error('rate limit exceeded'))).toBe(false)
    expect(isRateLimitError(Object.assign(new Error('unavailable'), { status: 503 }))).toBe(false)
  })
})

describe('retryWithExponentialBackoff retry budget', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('honors an admitted server delay without making an early request', async () => {
    vi.useFakeTimers()
    const retryable = Object.assign(new Error('rate limited'), {
      status: 429,
      retryAfterMs: 120,
    })
    const operation = vi.fn().mockRejectedValueOnce(retryable).mockResolvedValueOnce('ok')

    const result = retryWithExponentialBackoff(operation, {
      maxRetries: 1,
      initialDelayMs: 10,
      maxDelayMs: 30,
      retryBudgetMs: 150,
    })

    await vi.advanceTimersByTimeAsync(119)
    expect(operation).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    await expect(result).resolves.toBe('ok')
    expect(operation).toHaveBeenCalledTimes(2)
  })

  it('aborts provider work at one deadline across attempts', async () => {
    vi.useFakeTimers()
    let attempts = 0
    const operation = vi.fn(async (signal?: AbortSignal) => {
      attempts++
      if (attempts === 1)
        throw Object.assign(new Error('rate limited'), { status: 429, retryAfterMs: 60 })
      return new Promise<never>((_resolve, reject) =>
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
      )
    })
    const result = retryWithExponentialBackoff(operation, { maxRetries: 3, retryBudgetMs: 100 })
    const rejected = expect(result).rejects.toMatchObject({ name: 'TimeoutError' })
    await vi.advanceTimersByTimeAsync(99)
    expect(operation).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    await rejected
    expect(operation).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not retry when the server delay exceeds the operation budget', async () => {
    const retryable = Object.assign(new Error('rate limited'), {
      status: 429,
      retryAfterMs: 120,
    })
    const operation = vi.fn().mockRejectedValue(retryable)

    await expect(
      retryWithExponentialBackoff(operation, {
        maxRetries: 3,
        initialDelayMs: 1,
        maxDelayMs: 30,
        retryBudgetMs: 100,
      })
    ).rejects.toThrow('rate limited')
    expect(operation).toHaveBeenCalledOnce()
  })

  it('does not treat the legacy per-wait ceiling as a cumulative retry budget', async () => {
    vi.useFakeTimers()
    const retryable = Object.assign(new Error('service unavailable'), { status: 503 })
    const operation = vi
      .fn()
      .mockRejectedValueOnce(retryable)
      .mockRejectedValueOnce(retryable)
      .mockResolvedValueOnce('ok')

    const result = retryWithExponentialBackoff(operation, {
      maxRetries: 2,
      initialDelayMs: 10,
      maxDelayMs: 20,
      maxRetryAfterMs: 15,
    })

    await vi.runAllTimersAsync()
    await expect(result).resolves.toBe('ok')
    expect(operation).toHaveBeenCalledTimes(3)
  })

  it('cancels a retry wait without starting another attempt', async () => {
    const controller = new AbortController()
    const operation = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('service unavailable'), { status: 503 }))
    const result = retryWithExponentialBackoff(operation, {
      maxRetries: 2,
      initialDelayMs: 60_000,
      signal: controller.signal,
    })

    await vi.waitFor(() => expect(operation).toHaveBeenCalledOnce())
    controller.abort()

    await expect(result).rejects.toMatchObject({ name: 'AbortError' })
    expect(operation).toHaveBeenCalledOnce()
  })

  it.each([
    { retryBudgetMs: Number.NaN },
    { retryBudgetMs: Number.POSITIVE_INFINITY },
    { maxRetryAfterMs: -1 },
  ])('rejects invalid retry timing options: %o', async (invalid) => {
    await expect(retryWithExponentialBackoff(async () => 'ok', invalid)).rejects.toThrow(
      /finite non-negative/
    )
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
      profile: 'configuredEndpoint',
    })

    expect(response.status).toBe(200)
    expect(mockSecureFetchWithValidation).toHaveBeenCalledTimes(1)
    const [url, options, paramName] = mockSecureFetchWithValidation.mock.calls[0]
    expect(url).toBe('https://example.com/api')
    expect(options).toMatchObject({
      method: 'GET',
      headers: { Accept: 'application/json' },
      profile: 'configuredEndpoint',
    })
    expect(paramName).toBe('url')
  })

  it('propagates SSRF validation failures without retrying', async () => {
    mockSecureFetchWithValidation.mockRejectedValue(
      new Error('url resolves to a blocked IP address')
    )

    await expect(
      secureFetchWithRetry(
        'https://attacker.test',
        { method: 'GET', profile: 'configuredEndpoint' },
        FAST_RETRY
      )
    ).rejects.toThrow('blocked IP address')

    expect(mockSecureFetchWithValidation).toHaveBeenCalledTimes(1)
  })

  it('retries on a retryable status (503) and succeeds', async () => {
    mockSecureFetchWithValidation
      .mockResolvedValueOnce(fakeResponse(503, { body: 'try later' }))
      .mockResolvedValueOnce(fakeResponse(200, { body: 'ok' }))

    const response = await secureFetchWithRetry(
      'https://example.com/api',
      { method: 'GET', profile: 'configuredEndpoint' },
      FAST_RETRY
    )

    expect(response.status).toBe(200)
    expect(mockSecureFetchWithValidation).toHaveBeenCalledTimes(2)
  })

  it('does not retry a non-retryable status (404) and returns it to the caller', async () => {
    mockSecureFetchWithValidation.mockResolvedValue(fakeResponse(404, { body: 'missing' }))

    const response = await secureFetchWithRetry(
      'https://example.com/api',
      { method: 'GET', profile: 'configuredEndpoint' },
      FAST_RETRY
    )

    expect(response.status).toBe(404)
    expect(mockSecureFetchWithValidation).toHaveBeenCalledTimes(1)
  })

  it('forwards the egress profile, timeout and maxResponseBytes to the pinned fetch', async () => {
    mockSecureFetchWithValidation.mockResolvedValue(fakeResponse(200))

    await secureFetchWithRetry(
      'http://localhost:9000',
      { method: 'GET', profile: 'configuredEndpoint' },
      { timeout: 5000, maxResponseBytes: 1024, ...FAST_RETRY }
    )

    const [, options] = mockSecureFetchWithValidation.mock.calls[0]
    expect(options).toMatchObject({
      profile: 'configuredEndpoint',
      timeout: 5000,
      maxResponseBytes: 1024,
    })
  })

  /**
   * Covers `error.headers = response.headers` on the secure path: the retry loop
   * re-evaluates the condition against the thrown error, so without the headers
   * travelling with it a rate-limit 403 throws on the second evaluation.
   */
  it('retries a rate-limit 403 through the secure path and succeeds', async () => {
    mockSecureFetchWithValidation
      .mockResolvedValueOnce(
        fakeResponse(403, {
          headers: {
            'x-ratelimit-remaining': '0',
            'retry-after': '0.001',
          },
        })
      )
      .mockResolvedValueOnce(fakeResponse(200))

    const response = await secureFetchWithRetry(
      'https://api.github.com/repos',
      { method: 'GET', profile: 'configuredEndpoint' },
      FAST_RETRY
    )

    expect(response.status).toBe(200)
    expect(mockSecureFetchWithValidation).toHaveBeenCalledTimes(2)
  })

  it('does not retry an authorization 403 through the secure path', async () => {
    mockSecureFetchWithValidation.mockResolvedValue(
      fakeResponse(403, { headers: { 'x-ratelimit-remaining': '4999' } })
    )

    const response = await secureFetchWithRetry(
      'https://api.github.com/repos',
      { method: 'GET', profile: 'configuredEndpoint' },
      FAST_RETRY
    )

    expect(response.status).toBe(403)
    expect(mockSecureFetchWithValidation).toHaveBeenCalledTimes(1)
  })

  it('honors Retry-After (seconds) on a 429 before retrying', async () => {
    mockSecureFetchWithValidation
      .mockResolvedValueOnce(fakeResponse(429, { headers: { 'retry-after': '0' } }))
      .mockResolvedValueOnce(fakeResponse(200))

    const response = await secureFetchWithRetry(
      'https://example.com/api',
      { method: 'GET', profile: 'configuredEndpoint' },
      FAST_RETRY
    )

    expect(response.status).toBe(200)
    expect(mockSecureFetchWithValidation).toHaveBeenCalledTimes(2)
  })

  it('omits a provider-controlled response body from the secure retry error', async () => {
    const providerControlledMarker = 'provider-controlled-response-marker'
    mockSecureFetchWithValidation.mockResolvedValue(
      new Response(providerControlledMarker, { status: 503 }) as never
    )

    const error = await secureFetchWithRetry(
      'https://gitlab.example.com/api/v4/projects',
      { method: 'GET', profile: 'configuredEndpoint' },
      { ...FAST_RETRY, maxRetries: 0 }
    ).then(
      () => undefined,
      (caught) => caught as Error
    )

    expect(error?.message).toContain('[response body omitted]')
    expect(error?.message).not.toContain(providerControlledMarker)
  })
})
