/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { acquire, settle } = vi.hoisted(() => ({ acquire: vi.fn(), settle: vi.fn() }))
vi.mock('@/lib/core/rate-limiter/provider-capacity', () => ({ acquireProviderCapacity: acquire }))

import { ProviderCapacityDeferredError } from '@/lib/core/rate-limiter/provider-capacity-error'
import { isRateLimitError } from '@/lib/knowledge/documents/utils'
import { fetchGitHubWithRetry } from '@/connectors/github/request'

const URL = 'https://api.github.com/repos/example/repository/git/blobs/blob-id'
const OPTIONS = { headers: { Authorization: 'Bearer private-token' } }

describe('GitHub coordinated requests', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(1_800_000_000_000)
    vi.clearAllMocks()
    settle.mockImplementation(async (_outcome, retryAfterMs = 0) => retryAfterMs)
    acquire.mockResolvedValue({ settle })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('holds the credential lease until the streamed body is consumed and observes successful exhaustion', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('complete content', {
            headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1800003600' },
          })
      )
    )
    const response = await fetchGitHubWithRetry(URL, OPTIONS)
    expect(settle).not.toHaveBeenCalled()
    expect(await response.text()).toBe('complete content')
    expect(settle).toHaveBeenCalledWith('success', undefined, {
      remaining: 0,
      resetAt: 1_800_003_601_000,
    })
    expect(acquire.mock.calls[0]?.[0]).toMatchObject({
      providerId: 'github-rest',
      config: { maxConcurrent: 1 },
    })
    expect(acquire.mock.calls[0]?.[0].scope).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify(acquire.mock.calls)).not.toContain('private-token')
  })

  it('releases cancelled response bodies without waiting for the request timeout', async () => {
    const cancelled = vi.fn()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new ReadableStream({ cancel: cancelled })))
    )
    const response = await fetchGitHubWithRetry(URL, OPTIONS)
    await response.body?.cancel()
    expect(cancelled).toHaveBeenCalledOnce()
    expect(settle).toHaveBeenCalledOnce()
  })

  it('does not leak a lease when a caller abandons its body until the deadline', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new ReadableStream()))
    )
    const controller = new AbortController()
    await fetchGitHubWithRetry(URL, { ...OPTIONS, signal: controller.signal })
    controller.abort()
    await Promise.resolve()
    expect(settle).toHaveBeenCalledOnce()
  })

  it.each([403, 429])(
    'shares a %i primary throttle and defers without another provider request',
    async (status) => {
      const fetchMock = vi.fn(
        async () =>
          new Response('{}', {
            status,
            headers: {
              'retry-after': '1',
              'x-ratelimit-remaining': '0',
              'x-ratelimit-reset': '1800003600',
            },
          })
      )
      vi.stubGlobal('fetch', fetchMock)
      const error = await fetchGitHubWithRetry(URL, OPTIONS).catch((error: unknown) => error)
      expect(error).toMatchObject({ name: 'GitHubRequestDeferredError', retryAfterMs: 3_601_000 })
      expect(isRateLimitError(error)).toBe(true)
      expect(fetchMock).toHaveBeenCalledOnce()
      expect(settle).toHaveBeenCalledWith('rate_limit', 3_601_000, {
        remaining: 0,
        resetAt: 1_800_003_601_000,
      })
    }
  )

  it('shares secondary throttles identified only by the JSON message', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ message: 'You have exceeded a secondary rate limit.' }), {
          status: 403,
        })
    )
    vi.stubGlobal('fetch', fetchMock)
    await expect(fetchGitHubWithRetry(URL, OPTIONS)).rejects.toMatchObject({
      retryAfterMs: 60_000,
      rateLimited: true,
    })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(settle).toHaveBeenCalledWith('rate_limit', 60_000, undefined)
  })

  it('preserves ordinary authorization failures without imposing a provider cooldown', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ message: 'Resource not accessible by integration' }), {
            status: 403,
          })
      )
    )
    const response = await fetchGitHubWithRetry(URL, OPTIONS)
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ message: 'Resource not accessible by integration' })
    expect(settle).toHaveBeenCalledWith('failure', undefined, undefined)
  })

  it('hands a shared admission wait to the durable scheduler before fetching', async () => {
    acquire.mockRejectedValue(
      new ProviderCapacityDeferredError('admission_timeout', { retryAfterMs: 30_000 })
    )
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(fetchGitHubWithRetry(URL, OPTIONS)).rejects.toMatchObject({
      rateLimited: true,
      retryAfterMs: 30_000,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('acquires a fresh lease for each retry after a transient provider failure', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 503 }))
      .mockResolvedValueOnce(new Response('recovered'))
    vi.stubGlobal('fetch', fetchMock)
    const pending = fetchGitHubWithRetry(URL, OPTIONS, { initialDelayMs: 1, maxDelayMs: 1 })
    await vi.advanceTimersByTimeAsync(10)
    expect(await (await pending).text()).toBe('recovered')
    expect(acquire).toHaveBeenCalledTimes(2)
    expect(settle.mock.calls.map(([outcome]) => outcome)).toEqual(['failure', 'success'])
  })

  it('fails closed if publishing quota feedback becomes unavailable', async () => {
    settle.mockRejectedValue(new Error('storage unavailable'))
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('content'))
    )
    const response = await fetchGitHubWithRetry(URL, OPTIONS)
    await expect(response.text()).rejects.toMatchObject({
      name: 'GitHubRequestDeferredError',
      retryAfterMs: 5000,
    })
  })
})
