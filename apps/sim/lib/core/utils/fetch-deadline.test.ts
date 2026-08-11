/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { isTransportTimeoutError, withFetchDeadline } from '@/lib/core/utils/fetch-deadline'

describe('withFetchDeadline', () => {
  it('states the caller deadline as the transport deadline', () => {
    expect(withFetchDeadline({ method: 'POST' }, 3_000_000).timeout).toBe(3_000_000)
  })

  it('preserves the init the caller already built', () => {
    const signal = new AbortController().signal
    const init = withFetchDeadline({ method: 'POST', body: 'x', signal }, 1000)
    expect(init.method).toBe('POST')
    expect(init.body).toBe('x')
    expect(init.signal).toBe(signal)
  })

  it('rounds a fractional deadline up rather than down', () => {
    expect(withFetchDeadline({}, 1500.2).timeout).toBe(1501)
  })

  /*
   * The bug this module exists for: an absent application deadline must disable
   * the transport timer, never fall back to the runtime's 300s default.
   */
  it.each([
    ['undefined', undefined],
    ['zero', 0],
    ['negative', -1],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['NaN', Number.NaN],
  ])('disables the transport timer when the deadline is %s', (_label, deadline) => {
    expect(withFetchDeadline({}, deadline as number | undefined).timeout).toBe(false)
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
