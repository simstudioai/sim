import { afterEach, describe, expect, it, vi } from 'vitest'
import { CopilotBackendError } from '@/lib/mothership/request/go/stream'
import { StreamRetryWindow } from '@/lib/mothership/request/lifecycle/stream-retry'

afterEach(() => vi.useRealTimers())

describe('stream recovery budget', () => {
  it('survives multiple unavailable connections without resetting its deadline', () => {
    vi.useFakeTimers()
    const retry = new StreamRetryWindow(120_000)
    for (let index = 0; index < 6; index++) {
      const delay = retry.nextDelay(new TypeError('fetch failed'))
      expect(delay).not.toBeNull()
      vi.advanceTimersByTime(delay ?? 0)
    }
    expect(retry.attempt).toBe(6)
    expect(retry.remainingMs()).toBeLessThan(120_000)
    vi.advanceTimersByTime(120_000)
    expect(retry.nextDelay(new TypeError('fetch failed'))).toBeNull()
    expect(() => retry.remainingMs()).toThrow('could not be restored')
  })

  it('does not retry explicit Stop or a permanent rejection', () => {
    const retry = new StreamRetryWindow()
    const controller = new AbortController()
    controller.abort()
    expect(retry.nextDelay(new TypeError('fetch failed'), controller.signal)).toBeNull()
    expect(retry.nextDelay(new DOMException('Stopped', 'AbortError'))).toBeNull()
    expect(retry.nextDelay(new CopilotBackendError('Forbidden', { status: 403 }))).toBeNull()
    expect(retry.nextDelay(new Error('Invalid operation'))).toBeNull()
    expect(retry.attempt).toBe(0)
  })
})
