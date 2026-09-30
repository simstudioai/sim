import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BillingLimitError,
  CopilotBackendError,
  StreamEndedWithoutTerminalError,
  WorkerStreamInterruptedError,
  WorkerUnreachableError,
} from '@/lib/mothership/request/go/stream'
import { StreamRetryWindow } from '@/lib/mothership/request/lifecycle/stream-retry'

afterEach(() => vi.useRealTimers())

describe('stream recovery budget', () => {
  it('stops an ended-without-terminal stream after three retries on a leg with no deadline', () => {
    vi.useFakeTimers()
    const error = new StreamEndedWithoutTerminalError('/api/mothership')
    const retry = new StreamRetryWindow()
    for (let index = 0; index < 3; index++) {
      const delay = retry.nextDelay(error)
      expect(delay).not.toBeNull()
      vi.advanceTimersByTime(delay ?? 0)
    }
    expect(retry.nextDelay(error)).toBeNull()
    expect(retry.attempt).toBe(3)
  })

  it.each([
    new CopilotBackendError('Unavailable', { status: 500, body: '{"error":"Internal error"}' }),
    new CopilotBackendError('Unavailable', {
      status: 503,
      body: '{"error":"Account admission is unavailable"}',
    }),
  ])('gives a reachable worker that answers with a 5xx only three retries: %s', (error) => {
    vi.useFakeTimers()
    const retry = new StreamRetryWindow()
    for (let index = 0; index < 3; index++) {
      const delay = retry.nextDelay(error)
      expect(delay).not.toBeNull()
      vi.advanceTimersByTime(delay ?? 0)
    }
    expect(retry.nextDelay(error)).toBeNull()
  })

  it('keeps a reachable failure to three retries however often the worker reattaches', () => {
    vi.useFakeTimers()
    const error = new StreamEndedWithoutTerminalError('/api/mothership')
    const retry = new StreamRetryWindow()
    for (let index = 0; index < 3; index++) {
      retry.recovered()
      const delay = retry.nextDelay(error)
      expect(delay).not.toBeNull()
      vi.advanceTimersByTime(delay ?? 0)
    }
    retry.recovered()
    expect(retry.nextDelay(error)).toBeNull()
  })

  it('still gives the replacement worker its reachable retries after a long outage', () => {
    vi.useFakeTimers()
    const retry = new StreamRetryWindow()
    const unreachable = new CopilotBackendError('Unavailable', {
      status: 502,
      body: '<html><body>502 Bad Gateway</body></html>',
    })
    const start = Date.now()
    while (Date.now() - start < 70_000) {
      const delay = retry.nextDelay(unreachable)
      expect(delay).not.toBeNull()
      vi.advanceTimersByTime(delay ?? 0)
    }
    const reachable = new CopilotBackendError('Unavailable', {
      status: 503,
      body: '{"error":"Account admission is unavailable"}',
    })
    for (let index = 0; index < 3; index++) {
      const delay = retry.nextDelay(reachable)
      expect(delay).not.toBeNull()
      vi.advanceTimersByTime(delay ?? 0)
    }
    expect(retry.nextDelay(reachable)).toBeNull()
  })

  it('restarts the unreachable window once the worker answers again', () => {
    vi.useFakeTimers()
    const retry = new StreamRetryWindow()
    const unreachable = new WorkerUnreachableError(new TypeError('fetch failed'))
    for (let outage = 0; outage < 2; outage++) {
      const start = Date.now()
      while (Date.now() - start < 100_000) {
        const delay = retry.nextDelay(unreachable)
        expect(delay).not.toBeNull()
        vi.advanceTimersByTime(delay ?? 0)
      }
      retry.recovered()
    }
  })

  it('never retries a TypeError thrown by our own stream handling', () => {
    const retry = new StreamRetryWindow()
    expect(
      retry.nextDelay(new TypeError("Cannot read properties of undefined (reading 'payload')"))
    ).toBeNull()
  })

  it.each([
    new WorkerUnreachableError(new TypeError('fetch failed')),
    new CopilotBackendError('Unavailable', { status: 502 }),
    new CopilotBackendError('Unavailable', {
      status: 504,
      body: '<html><body><h1>504 Gateway Time-out</h1></body></html>',
    }),
  ])('keeps retrying an unreachable worker for two minutes from the first failure: %s', (error) => {
    vi.useFakeTimers()
    const retry = new StreamRetryWindow()
    vi.advanceTimersByTime(600_000)
    const firstFailure = Date.now()
    for (;;) {
      const delay = retry.nextDelay(error)
      if (delay === null) break
      vi.advanceTimersByTime(delay)
    }
    expect(Date.now() - firstFailure).toBeGreaterThan(110_000)
    expect(Date.now() - firstFailure).toBeLessThanOrEqual(120_000)
  })

  it('never extends the original execution deadline', () => {
    vi.useFakeTimers()
    const retry = new StreamRetryWindow(120_000)
    vi.advanceTimersByTime(119_999)
    expect(retry.nextDelay(new WorkerUnreachableError(new TypeError('fetch failed')))).toBeNull()
    vi.advanceTimersByTime(120_000)
    expect(retry.nextDelay(new WorkerUnreachableError(new TypeError('fetch failed')))).toBeNull()
    expect(() => retry.remainingMs()).toThrow('could not be restored')
  })

  it('does not retry explicit Stop or a permanent rejection', () => {
    const retry = new StreamRetryWindow()
    const controller = new AbortController()
    controller.abort()
    expect(
      retry.nextDelay(new WorkerUnreachableError(new TypeError('fetch failed')), controller.signal)
    ).toBeNull()
    expect(retry.nextDelay(new DOMException('Stopped', 'AbortError'))).toBeNull()
    expect(retry.nextDelay(new CopilotBackendError('Forbidden', { status: 403 }))).toBeNull()
    expect(retry.nextDelay(new Error('Invalid operation'))).toBeNull()
    expect(retry.nextDelay(new BillingLimitError('user-1'))).toBeNull()
    expect(retry.attempt).toBe(0)
  })

  it('gives a stream cut mid-body the reachable budget, not the unreachable window', () => {
    vi.useFakeTimers()
    const error = new WorkerStreamInterruptedError(new Error('socket closed'))
    const retry = new StreamRetryWindow()
    for (let index = 0; index < 3; index++) {
      const delay = retry.nextDelay(error)
      expect(delay).not.toBeNull()
      vi.advanceTimersByTime(delay ?? 0)
    }
    expect(retry.nextDelay(error)).toBeNull()
  })

  it('has no leg deadline unless the caller sets one', () => {
    vi.useFakeTimers()
    const retry = new StreamRetryWindow()
    vi.advanceTimersByTime(3 * 60 * 60 * 1000)
    expect(retry.remainingMs()).toBeUndefined()
    expect(retry.nextDelay(new StreamEndedWithoutTerminalError('/api/mothership'))).not.toBeNull()
  })

  it('gives an interruption hours into a healthy leg a fresh reachable budget', () => {
    vi.useFakeTimers()
    const error = new WorkerStreamInterruptedError(new Error('socket closed'))
    const retry = new StreamRetryWindow()
    for (let index = 0; index < 3; index++) {
      const delay = retry.nextDelay(error)
      expect(delay).not.toBeNull()
      vi.advanceTimersByTime(delay ?? 0)
    }
    for (let minute = 0; minute < 3 * 60; minute++) {
      retry.recovered()
      vi.advanceTimersByTime(60_000)
    }
    for (let index = 0; index < 3; index++) {
      const delay = retry.nextDelay(error)
      expect(delay).not.toBeNull()
      vi.advanceTimersByTime(delay ?? 0)
    }
    expect(retry.nextDelay(error)).toBeNull()
  })

  it('keeps the reachable budget spent when the leg fails again soon after re-attaching', () => {
    vi.useFakeTimers()
    const error = new WorkerStreamInterruptedError(new Error('socket closed'))
    const retry = new StreamRetryWindow()
    for (let index = 0; index < 3; index++) {
      const delay = retry.nextDelay(error)
      expect(delay).not.toBeNull()
      vi.advanceTimersByTime(delay ?? 0)
      for (let event = 0; event < 5; event++) {
        retry.recovered()
        vi.advanceTimersByTime(1_000)
      }
    }
    retry.recovered()
    expect(retry.nextDelay(error)).toBeNull()
  })

  it('does not refill the reachable budget for a leg that delivered one event and then went quiet', () => {
    vi.useFakeTimers()
    const error = new WorkerStreamInterruptedError(new Error('socket closed'))
    const retry = new StreamRetryWindow()
    for (let index = 0; index < 3; index++) {
      const delay = retry.nextDelay(error)
      expect(delay).not.toBeNull()
      vi.advanceTimersByTime(delay ?? 0)
    }
    retry.recovered()
    vi.advanceTimersByTime(30 * 60_000)
    expect(retry.nextDelay(error)).toBeNull()
  })

  it('retries a leg that fails again minutes after it re-attached and delivered events', () => {
    vi.useFakeTimers()
    const error = new WorkerStreamInterruptedError(new Error('socket closed'))
    const retry = new StreamRetryWindow()
    const first = retry.nextDelay(error)
    expect(first).not.toBeNull()
    vi.advanceTimersByTime(first ?? 0)
    for (let second = 0; second < 120; second += 10) {
      retry.recovered()
      vi.advanceTimersByTime(10_000)
    }
    expect(retry.nextDelay(error)).not.toBeNull()
  })
})
