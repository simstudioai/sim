import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { exchangeGoogleServiceAccountJwt } from '@/lib/oauth/google-service-account-transport'

const { warn } = vi.hoisted(() => ({ warn: vi.fn() }))
vi.mock('@sim/logger', () => ({
  createLogger: () => ({ warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

const TOKEN_URI = 'https://oauth2.googleapis.com/token'
const ASSERTION = 'private-jwt-assertion'
const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  vi.useFakeTimers()
  fetchMock.mockReset()
  warn.mockClear()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('Google service-account token transport', () => {
  it.each([429, 503])(
    'recovers a transient HTTP %s without changing the assertion',
    async (status) => {
      const first = Response.json({ error: 'temporarily_unavailable' }, { status })
      fetchMock
        .mockResolvedValueOnce(first)
        .mockResolvedValueOnce(Response.json({ access_token: 'token' }))
      const request = exchangeGoogleServiceAccountJwt(TOKEN_URI, ASSERTION)
      const checked = expect(request).resolves.toMatchObject({ status: 200 })
      await vi.runAllTimersAsync()
      await checked
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(first.bodyUsed).toBe(true)
      for (const [url, init] of fetchMock.mock.calls) {
        expect(url).toBe(TOKEN_URI)
        expect(init?.signal).toBeInstanceOf(AbortSignal)
        expect(init?.redirect).toBe('error')
        expect((init?.body as URLSearchParams).get('assertion')).toBe(ASSERTION)
      }
    }
  )

  it.each([400])('returns permanent HTTP %s without retrying', async (status) => {
    const response = Response.json({ error: 'invalid_grant' }, { status })
    fetchMock.mockResolvedValueOnce(response)
    await expect(exchangeGoogleServiceAccountJwt(TOKEN_URI, ASSERTION)).resolves.toEqual({
      ok: false,
      status,
      body: '{"error":"invalid_grant"}',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(response.bodyUsed).toBe(true)
  })

  it('bounds repeated failures to three attempts and preserves the final error response', async () => {
    fetchMock.mockImplementation(async () =>
      Response.json({ error: 'temporarily_unavailable' }, { status: 503 })
    )
    const request = exchangeGoogleServiceAccountJwt(TOKEN_URI, ASSERTION)
    await vi.runAllTimersAsync()
    const response = await request
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(response.status).toBe(503)
    expect(JSON.parse(response.body)).toEqual({ error: 'temporarily_unavailable' })
  })

  it('retries a network reset and preserves permanent transport failures', async () => {
    const reset = new TypeError('fetch failed', {
      cause: Object.assign(new Error('socket'), { code: 'ECONNRESET' }),
    })
    fetchMock
      .mockRejectedValueOnce(reset)
      .mockResolvedValueOnce(Response.json({ access_token: 'token' }))
    const request = exchangeGoogleServiceAccountJwt(TOKEN_URI, ASSERTION)
    const checked = expect(request).resolves.toMatchObject({ status: 200 })
    await vi.runAllTimersAsync()
    await checked
    expect(fetchMock).toHaveBeenCalledTimes(2)
    fetchMock.mockReset()
    const rejected = new TypeError('Invalid URL')
    fetchMock.mockRejectedValueOnce(rejected)
    await expect(exchangeGoogleServiceAccountJwt(TOKEN_URI, ASSERTION)).rejects.toBe(rejected)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('honors Retry-After and does not shorten waits exceeding the total budget', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'Retry-After': '5' } }))
      .mockResolvedValueOnce(Response.json({ access_token: 'token' }))
    const request = exchangeGoogleServiceAccountJwt(TOKEN_URI, ASSERTION)
    await vi.advanceTimersByTimeAsync(4999)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    await expect(request).resolves.toMatchObject({ status: 200 })
    fetchMock.mockReset()
    const response = new Response(null, { status: 429, headers: { 'Retry-After': '60' } })
    fetchMock.mockResolvedValueOnce(response)
    await expect(exchangeGoogleServiceAccountJwt(TOKEN_URI, ASSERTION)).resolves.toEqual({
      ok: false,
      status: 429,
      body: '',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('preserves caller cancellation before requests and during retry waits', async () => {
    const controller = new AbortController()
    const reason = new DOMException('Cancelled', 'AbortError')
    controller.abort(reason)
    await expect(
      exchangeGoogleServiceAccountJwt(TOKEN_URI, ASSERTION, controller.signal)
    ).rejects.toBe(reason)
    expect(fetchMock).not.toHaveBeenCalled()
    const waiting = new AbortController()
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }))
    const request = exchangeGoogleServiceAccountJwt(TOKEN_URI, ASSERTION, waiting.signal)
    const checked = expect(request).rejects.toBe(reason)
    await vi.advanceTimersByTimeAsync(1)
    waiting.abort(reason)
    await checked
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('aborts a hung request when its total budget expires', async () => {
    let requestSignal: AbortSignal | null | undefined
    fetchMock.mockImplementation((_url, init) => {
      requestSignal = init?.signal
      return new Promise<Response>(() => undefined)
    })
    const request = exchangeGoogleServiceAccountJwt(TOKEN_URI, ASSERTION)
    const checked = expect(request).rejects.toMatchObject({ name: 'TimeoutError' })
    await vi.advanceTimersByTimeAsync(30_000)
    await checked
    expect(requestSignal?.aborted).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each([200, 503])(
    'bounds a stalled HTTP %s response body within the same deadline',
    async (status) => {
      let requestSignal: AbortSignal | null | undefined
      fetchMock.mockImplementation(async (_url, init) => {
        requestSignal = init?.signal
        return new Response(
          new ReadableStream({
            start(controller) {
              requestSignal?.addEventListener(
                'abort',
                () => controller.error(requestSignal?.reason),
                { once: true }
              )
            },
          }),
          { status }
        )
      })
      const request = exchangeGoogleServiceAccountJwt(TOKEN_URI, ASSERTION)
      const checked = expect(request).rejects.toMatchObject({ name: 'TimeoutError' })
      await vi.advanceTimersByTimeAsync(30_000)
      await checked
      expect(warn).toHaveBeenCalledWith(
        'Google service account token transport failed',
        expect.objectContaining({ stage: 'reading_response', currentStatus: status, attempts: 1 })
      )
      expect(requestSignal?.aborted).toBe(true)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    }
  )

  it('preserves the exact caller abort while reading an error body', async () => {
    const caller = new AbortController()
    const reason = new DOMException('Caller cancelled', 'AbortError')
    fetchMock.mockImplementation(
      async (_url, init) =>
        new Response(
          new ReadableStream({
            start(controller) {
              init?.signal?.addEventListener(
                'abort',
                () => controller.error(new Error('body closed')),
                { once: true }
              )
            },
          }),
          { status: 400 }
        )
    )
    const request = exchangeGoogleServiceAccountJwt(TOKEN_URI, ASSERTION, caller.signal)
    const checked = expect(request).rejects.toBe(reason)
    await vi.advanceTimersByTimeAsync(1)
    caller.abort(reason)
    await checked
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(warn).not.toHaveBeenCalled()
  })
})

it('distinguishes a prior HTTP response from a stalled next request without logging secrets', async () => {
  fetchMock
    .mockResolvedValueOnce(Response.json({ error: 'private-provider-detail' }, { status: 503 }))
    .mockImplementationOnce(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
        })
    )
  const result = exchangeGoogleServiceAccountJwt(TOKEN_URI, ASSERTION)
  const checked = expect(result).rejects.toMatchObject({ name: 'TimeoutError' })
  await vi.advanceTimersByTimeAsync(30_000)
  await checked
  expect(warn).toHaveBeenCalledWith(
    'Google service account token transport failed',
    expect.objectContaining({
      stage: 'awaiting_response',
      attempts: 2,
      lastHttpStatus: 503,
      timedOut: true,
    })
  )
  expect(warn.mock.calls[0][1]).not.toHaveProperty('currentStatus')
  expect(JSON.stringify(warn.mock.calls)).not.toMatch(
    /private-provider-detail|private-jwt-assertion|oauth2.googleapis.com/
  )
})
