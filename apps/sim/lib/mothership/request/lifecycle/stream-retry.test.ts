import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CopilotBackendError,
  StreamEndedWithoutTerminalError,
} from '@/lib/mothership/request/go/stream'
import { StreamRetryWindow } from '@/lib/mothership/request/lifecycle/stream-retry'

afterEach(() => vi.useRealTimers())

describe('stream recovery budget', () => {
  it.each([
    new TypeError('fetch failed'),
    new StreamEndedWithoutTerminalError('/api/mothership'),
    new CopilotBackendError('Unavailable', { status: 503 }),
  ])('stops after three retries despite a long task budget: %s', (error) => {
    vi.useFakeTimers()
    const retry = new StreamRetryWindow()
    for (let index = 0; index < 3; index++) {
      const delay = retry.nextDelay(error)
      expect(delay).not.toBeNull()
      vi.advanceTimersByTime(delay ?? 0)
    }
    expect(retry.nextDelay(error)).toBeNull()
    expect(retry.attempt).toBe(3)
    expect(retry.remainingMs()).toBeGreaterThan(3_500_000)
  })

  it('bounds the recovery period from the first failure without shortening healthy work', () => {
    vi.useFakeTimers()
    const retry = new StreamRetryWindow()
    vi.advanceTimersByTime(600_000)
    expect(retry.nextDelay(new TypeError('fetch failed'))).not.toBeNull()
    vi.advanceTimersByTime(30_000)
    expect(retry.nextDelay(new TypeError('fetch failed'))).toBeNull()
    expect(retry.remainingMs()).toBe(2_970_000)
  })

  it('never extends the original execution deadline', () => {
    vi.useFakeTimers()
    const retry = new StreamRetryWindow(120_000)
    vi.advanceTimersByTime(119_999)
    expect(retry.nextDelay(new TypeError('fetch failed'))).toBeNull()
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
