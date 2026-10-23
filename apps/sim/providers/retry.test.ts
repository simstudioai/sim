/**
 * Failure modes of the shared provider retry policy. A lost retry fails a run on a transient
 * upstream fault; a wrong one re-bills a completion or hammers a spent account.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchWithProviderRetry, withProviderRetry } from '@/providers/retry'
import { PROVIDER_MAX_RETRIES } from '@/providers/transport'

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never
const MAX_ATTEMPTS = PROVIDER_MAX_RETRIES + 1

function reply(status: number, body = '', headers: Record<string, string> = {}) {
  return () => Promise.resolve(new Response(body || null, { status, headers }))
}

function connectionReset() {
  return Object.assign(new Error('The socket connection was closed unexpectedly'), {
    code: 'ECONNRESET',
  })
}

/** Runs the call to completion while fake timers drive every backoff sleep. */
async function settle<T>(promise: Promise<T>): Promise<T> {
  const outcome = promise.then(
    (value) => ({ value }),
    (error: unknown) => ({ error })
  )
  await vi.runAllTimersAsync()
  const result = await outcome
  if ('error' in result) throw result.error
  return result.value
}

describe('fetchWithProviderRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('retries a transient 5xx and returns the later success', async () => {
    const send = vi.fn().mockImplementationOnce(reply(500)).mockImplementation(reply(200, 'ok'))

    const response = await settle(fetchWithProviderRetry(send, { logger, label: 'OpenAI' }))

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('ok')
    expect(send).toHaveBeenCalledTimes(2)
  })

  it.each([408, 409, 429, 502, 503])('treats %i as transient', async (status) => {
    const send = vi.fn().mockImplementationOnce(reply(status)).mockImplementation(reply(200))

    const response = await settle(fetchWithProviderRetry(send, { logger, label: 'OpenAI' }))

    expect(response.status).toBe(200)
  })

  it('stops after the retry budget and hands back the last response with its body intact', async () => {
    const send = vi.fn().mockImplementation(reply(500, '{"error":{"message":"server error"}}'))

    const response = await settle(fetchWithProviderRetry(send, { logger, label: 'OpenAI' }))

    expect(send).toHaveBeenCalledTimes(MAX_ATTEMPTS)
    expect(response.status).toBe(500)
    expect(await response.text()).toContain('server error')
  })

  it('never replays a request the provider rejected as invalid', async () => {
    const send = vi.fn().mockImplementation(reply(400))

    const response = await settle(fetchWithProviderRetry(send, { logger, label: 'OpenAI' }))

    expect(response.status).toBe(400)
    expect(send).toHaveBeenCalledTimes(1)
  })

  /** OpenAI answers 429 for a spent balance too, and that one never reopens on its own. */
  it('does not retry an exhausted quota, and leaves its body readable for the caller', async () => {
    const body = JSON.stringify({ error: { type: 'insufficient_quota', message: 'No credit' } })
    const send = vi.fn().mockImplementation(reply(429, body))

    const response = await settle(fetchWithProviderRetry(send, { logger, label: 'OpenAI' }))

    expect(send).toHaveBeenCalledTimes(1)
    expect(await response.text()).toContain('No credit')
  })

  it('discards a retryable response whose body never finishes instead of waiting on it', async () => {
    const endless = new ReadableStream<Uint8Array>({
      start(stream) {
        stream.enqueue(new TextEncoder().encode('<html>'))
      },
    })
    const send = vi
      .fn()
      .mockResolvedValueOnce(new Response(endless, { status: 503 }))
      .mockImplementation(reply(200))

    const response = await settle(fetchWithProviderRetry(send, { logger, label: 'OpenAI' }))

    expect(response.status).toBe(200)
  })

  it('treats a rate limit whose body never finishes as a rate limit, without a caller signal', async () => {
    const endless = new ReadableStream<Uint8Array>({
      start(stream) {
        stream.enqueue(new TextEncoder().encode('{"error":'))
      },
    })
    const send = vi
      .fn()
      .mockResolvedValueOnce(new Response(endless, { status: 429 }))
      .mockImplementation(reply(200))

    const response = await settle(fetchWithProviderRetry(send, { logger, label: 'OpenAI' }))

    expect(response.status).toBe(200)
  })

  it('retries a rate limit whose body is too large to classify', async () => {
    const send = vi
      .fn()
      .mockImplementationOnce(reply(429, 'x'.repeat(256 * 1024)))
      .mockImplementation(reply(200))

    const response = await settle(fetchWithProviderRetry(send, { logger, label: 'OpenAI' }))

    expect(response.status).toBe(200)
  })

  it('stops reading a rate-limit body that never finishes once the caller aborts', async () => {
    const controller = new AbortController()
    const endless = new ReadableStream<Uint8Array>({
      start(stream) {
        stream.enqueue(new TextEncoder().encode('{"error":'))
      },
    })
    const send = vi.fn().mockResolvedValue(new Response(endless, { status: 429 }))

    const outcome = fetchWithProviderRetry(send, {
      logger,
      label: 'OpenAI',
      abortSignal: controller.signal,
    }).catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(0)
    controller.abort()

    expect(await outcome).toMatchObject({ name: 'AbortError' })
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('obeys the server when it says a 5xx must not be retried', async () => {
    const send = vi.fn().mockImplementation(reply(500, '', { 'x-should-retry': 'false' }))

    await settle(fetchWithProviderRetry(send, { logger, label: 'OpenAI' }))

    expect(send).toHaveBeenCalledTimes(1)
  })

  it('obeys the server when it says a 4xx is safe to retry', async () => {
    const send = vi
      .fn()
      .mockImplementationOnce(reply(400, '', { 'x-should-retry': 'true' }))
      .mockImplementation(reply(200))

    const response = await settle(fetchWithProviderRetry(send, { logger, label: 'OpenAI' }))

    expect(response.status).toBe(200)
  })

  it('waits the retry-after-ms the server asked for before replaying', async () => {
    const send = vi
      .fn()
      .mockImplementationOnce(reply(429, '', { 'retry-after-ms': '4000', 'retry-after': '1' }))
      .mockImplementation(reply(200))

    const pending = fetchWithProviderRetry(send, { logger, label: 'OpenAI' })
    await vi.advanceTimersByTimeAsync(3900)
    expect(send).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(200)
    expect(send).toHaveBeenCalledTimes(2)
    await pending
  })

  /** A daily quota or provider-wide pause outlasts any backoff; the fallback model should run now. */
  it('does not wait out a server delay longer than the retry window', async () => {
    const send = vi.fn().mockImplementation(reply(429, '', { 'retry-after': '120' }))

    const response = await settle(fetchWithProviderRetry(send, { logger, label: 'OpenAI' }))

    expect(response.status).toBe(429)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['Bun connection reset', connectionReset()],
    [
      'Bun refused connection',
      Object.assign(new Error('Unable to connect'), { code: 'ConnectionRefused' }),
    ],
    [
      'Node connection reset',
      new TypeError('fetch failed', { cause: Object.assign(new Error(), { code: 'ECONNRESET' }) }),
    ],
    [
      'Node refused connection',
      new TypeError('fetch failed', {
        cause: Object.assign(new AggregateError([]), { code: 'ECONNREFUSED' }),
      }),
    ],
    [
      'TypeError caused by a socket error, whatever its message',
      new TypeError('network error', { cause: Object.assign(new Error(), { code: 'ECONNRESET' }) }),
    ],
  ])('retries a %s', async (_, failure) => {
    const send = vi.fn().mockRejectedValueOnce(failure).mockImplementation(reply(200))

    const response = await settle(fetchWithProviderRetry(send, { logger, label: 'OpenAI' }))

    expect(response.status).toBe(200)
  })

  it.each([
    ['an unrecognised failure', new Error('body serialization failed')],
    ['a TypeError from building the request', new TypeError('Invalid URL')],
    [
      'an application error code',
      Object.assign(new Error('overloaded'), { code: 'RESOURCE_EXHAUSTED' }),
    ],
    ['a database error code', Object.assign(new Error('admin shutdown'), { code: '57P01' })],
  ])('does not retry %s', async (_, failure) => {
    const send = vi.fn().mockRejectedValue(failure)

    await expect(settle(fetchWithProviderRetry(send, { logger, label: 'OpenAI' }))).rejects.toBe(
      failure
    )
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('stops as soon as the caller aborts during backoff', async () => {
    const controller = new AbortController()
    const send = vi.fn().mockImplementation(reply(503))

    const pending = fetchWithProviderRetry(send, {
      logger,
      label: 'OpenAI',
      abortSignal: controller.signal,
    })
    const outcome = pending.catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(0)
    controller.abort()

    expect(await outcome).toMatchObject({ name: 'AbortError' })
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('surfaces the real failure of a request the caller already aborted, without a retry', async () => {
    const controller = new AbortController()
    const send = vi.fn().mockImplementation(() => {
      controller.abort()
      return Promise.reject(connectionReset())
    })

    await expect(
      settle(
        fetchWithProviderRetry(send, {
          logger,
          label: 'OpenAI',
          abortSignal: controller.signal,
        })
      )
    ).rejects.toMatchObject({ code: 'ECONNRESET' })
    expect(send).toHaveBeenCalledTimes(1)
  })
})

describe('withProviderRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function sdkError(status: number) {
    return Object.assign(new Error(`got status: ${status}`), { status })
  }

  it('retries an SDK error that carries a transient status', async () => {
    const operation = vi.fn().mockRejectedValueOnce(sdkError(503)).mockResolvedValue('answer')

    await expect(settle(withProviderRetry(operation, { logger, label: 'Gemini' }))).resolves.toBe(
      'answer'
    )
    expect(operation).toHaveBeenCalledTimes(2)
  })

  it('surfaces the original SDK error once retries are exhausted', async () => {
    const final = sdkError(500)
    const operation = vi.fn().mockRejectedValue(final)

    await expect(settle(withProviderRetry(operation, { logger, label: 'Gemini' }))).rejects.toBe(
      final
    )
    expect(operation).toHaveBeenCalledTimes(MAX_ATTEMPTS)
  })

  it('does not retry an SDK error that carries a permanent status', async () => {
    const operation = vi.fn().mockRejectedValue(sdkError(400))

    await expect(settle(withProviderRetry(operation, { logger, label: 'Gemini' }))).rejects.toThrow(
      'status: 400'
    )
    expect(operation).toHaveBeenCalledTimes(1)
  })

  it('waits the delay the caller reads off the SDK error before replaying', async () => {
    const operation = vi.fn().mockRejectedValueOnce(sdkError(429)).mockResolvedValue('answer')

    const pending = withProviderRetry(operation, {
      logger,
      label: 'Gemini',
      retryAfterMs: () => 7000,
    })
    await vi.advanceTimersByTimeAsync(6900)
    expect(operation).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(200)
    await expect(pending).resolves.toBe('answer')
  })

  it('surfaces an SDK error at once when its delay is longer than the retry window', async () => {
    const quota = sdkError(429)
    const operation = vi.fn().mockRejectedValue(quota)

    await expect(
      settle(
        withProviderRetry(operation, { logger, label: 'Gemini', retryAfterMs: () => 3_600_000 })
      )
    ).rejects.toBe(quota)
    expect(operation).toHaveBeenCalledTimes(1)
  })

  /** A malformed request fails inside the SDK before any fetch; replaying cannot fix it. */
  it('does not retry a TypeError the SDK raised while building the request', async () => {
    const bug = new TypeError("Cannot use 'in' operator to search for 'functionDeclarations'")
    const operation = vi.fn().mockRejectedValue(bug)

    await expect(settle(withProviderRetry(operation, { logger, label: 'Gemini' }))).rejects.toBe(
      bug
    )
    expect(operation).toHaveBeenCalledTimes(1)
  })
})
