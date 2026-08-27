/**
 * @vitest-environment node
 */
import { Agent } from 'undici'
import { describe, expect, it } from 'vitest'
import { isTransportTimeoutError, withCallerOwnedDeadline } from '@/lib/core/utils/fetch-deadline'

describe('withCallerOwnedDeadline', () => {
  /*
   * The pinned Bun ignores a positive numeric `timeout` and honors only the
   * boolean/zero form, so anything other than `false` here silently leaves the
   * 300s default in force — which is the outage this module exists to prevent.
   */
  it('disarms the transport timer rather than negotiating a value', () => {
    expect(withCallerOwnedDeadline({}).timeout).toBe(false)
  })

  /*
   * Tests run under Node, where `timeout: false` is ignored and undici's
   * 300s `headersTimeout` default is what killed async (Trigger.dev) sandbox
   * runs. The dispatcher is what disarms it there; dropping it regresses every
   * worker-side internal route call longer than five minutes.
   */
  it('attaches a dispatcher on runtimes whose fetch is undici', () => {
    expect(withCallerOwnedDeadline({}).dispatcher).toBeInstanceOf(Agent)
  })

  it('reuses one dispatcher across calls so pooled connections are shared', () => {
    expect(withCallerOwnedDeadline({}).dispatcher).toBe(withCallerOwnedDeadline({}).dispatcher)
  })

  it('preserves the init the caller already built', () => {
    const signal = new AbortController().signal
    const init = withCallerOwnedDeadline({ method: 'POST', body: 'x', signal })
    expect(init.method).toBe('POST')
    expect(init.body).toBe('x')
    expect(init.signal).toBe(signal)
  })

  it('does not mutate the caller’s init', () => {
    const original: RequestInit = { method: 'POST' }
    withCallerOwnedDeadline(original)
    expect('timeout' in original).toBe(false)
    expect('dispatcher' in original).toBe(false)
  })
})

describe('isTransportTimeoutError', () => {
  it('recognizes the runtime timeout', () => {
    const error = new Error('The operation timed out.')
    error.name = 'TimeoutError'
    expect(isTransportTimeoutError(error)).toBe(true)
  })

  it('recognizes a severed connection', () => {
    expect(isTransportTimeoutError(new TypeError('fetch failed'))).toBe(true)
  })

  it('does not claim a cancellation', () => {
    const error = new Error('aborted')
    error.name = 'AbortError'
    expect(isTransportTimeoutError(error)).toBe(false)
  })

  it.each([
    ['an unrelated TypeError', new TypeError('x is not a function')],
    ['a plain error', new Error('boom')],
    ['a non-error', 'fetch failed'],
  ])('does not claim %s', (_label, value) => {
    expect(isTransportTimeoutError(value)).toBe(false)
  })
})
