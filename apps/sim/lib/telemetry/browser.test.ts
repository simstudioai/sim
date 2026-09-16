/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/utils/random', () => ({ randomFloat: () => 0 }))
vi.mock('@/lib/core/security/redaction', () => ({ sanitizeEventData: (value: unknown) => value }))

import { startBrowserTelemetry } from '@/lib/telemetry/browser'
import { setBrowserTelemetryPreference } from '@/lib/telemetry/browser-preference'

const fetchMock = vi.fn().mockResolvedValue({ ok: true })
const observers: Array<{
  disconnect: ReturnType<typeof vi.fn>
  observe: ReturnType<typeof vi.fn>
  callback: PerformanceObserverCallback
}> = []
let stop: (() => void) | undefined

function reportError() {
  window.dispatchEvent(new ErrorEvent('error', { message: 'Example failure' }))
}

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal(
    'PerformanceObserver',
    class {
      static supportedEntryTypes = ['largest-contentful-paint', 'layout-shift', 'first-input']
      disconnect = vi.fn()
      observe = vi.fn()
      constructor(public callback: PerformanceObserverCallback) {
        observers.push(this)
      }
    }
  )
})

afterEach(() => {
  stop?.()
  stop = undefined
  observers.length = 0
  vi.restoreAllMocks()
  setBrowserTelemetryPreference(true)
  localStorage.clear()
  vi.clearAllMocks()
  vi.useRealTimers()
})

describe('optional browser telemetry lifecycle', () => {
  it('preserves one-shot paint/input samples and aggregates layout shifts only at exit', () => {
    stop = startBrowserTelemetry(false)
    const emit = (type: string, entries: object[]) => {
      const observer = observers.find((item) => item.observe.mock.calls[0]?.[0].type === type)
      if (!observer) throw new Error(`Missing observer for ${type}`)
      observer.callback(
        { getEntries: () => entries } as PerformanceObserverEntryList,
        observer as unknown as PerformanceObserver
      )
      return observer
    }
    expect(
      emit('largest-contentful-paint', [{ startTime: 10 }, { startTime: 20 }]).disconnect
    ).toHaveBeenCalledOnce()
    expect(
      emit('first-input', [{ startTime: 100, processingStart: 110 }]).disconnect
    ).toHaveBeenCalledOnce()
    emit('layout-shift', [
      { hadRecentInput: false, value: 0.1 },
      { hadRecentInput: true, value: 1 },
    ])
    emit('layout-shift', [{ hadRecentInput: false, value: 0.2 }])
    expect(fetchMock).not.toHaveBeenCalled()
    window.dispatchEvent(new Event('pagehide'))
    const events = JSON.parse(fetchMock.mock.calls[0][1].body).events
    expect(events).toHaveLength(3)
    expect(events).toEqual([
      expect.objectContaining({ label: 'LCP', value: 20 }),
      expect.objectContaining({ label: 'FID', value: 10 }),
      expect.objectContaining({ label: 'CLS', value: expect.closeTo(0.3) }),
    ])
    window.dispatchEvent(new Event('pagehide'))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    emit('layout-shift', [{ hadRecentInput: false, value: 0.5 }])
    setBrowserTelemetryPreference(false)
    window.dispatchEvent(new Event('pagehide'))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('collects nothing until started, then batches diagnostics', async () => {
    reportError()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(fetchMock).not.toHaveBeenCalled()

    stop = startBrowserTelemetry(false)
    reportError()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/telemetry')
    expect(JSON.parse(options.body).events).toEqual([
      expect.objectContaining({ category: 'error', message: 'Example failure' }),
    ])
    expect(
      observers.every((observer) => observer.observe.mock.calls[0][0].buffered === false)
    ).toBe(true)
  })

  it('discards the queue, detaches observers, and aborts requests on withdrawal', async () => {
    stop = startBrowserTelemetry(false)
    reportError()
    await vi.advanceTimersByTimeAsync(10_000)
    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal
    reportError()

    setBrowserTelemetryPreference(false)
    expect(signal.aborted).toBe(true)
    expect(observers.every((observer) => observer.disconnect.mock.calls.length === 1)).toBe(true)
    reportError()
    window.dispatchEvent(new Event('pagehide'))
    await vi.advanceTimersByTimeAsync(20_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('honors withdrawal in another tab without flushing its queued events', async () => {
    stop = startBrowserTelemetry(false)
    reportError()
    localStorage.setItem('simstudio-telemetry-status', JSON.stringify({ enabled: false }))
    window.dispatchEvent(new StorageEvent('storage', { key: 'simstudio-telemetry-status' }))
    window.dispatchEvent(new Event('pagehide'))
    await vi.advanceTimersByTimeAsync(10_000)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(observers.every((observer) => observer.disconnect.mock.calls.length === 1)).toBe(true)
  })

  it('stops immediately when a local refusal cannot be persisted', async () => {
    setBrowserTelemetryPreference(true)
    stop = startBrowserTelemetry(false)
    reportError()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage full', 'QuotaExceededError')
    })

    setBrowserTelemetryPreference(false)
    window.dispatchEvent(new Event('pagehide'))
    await vi.advanceTimersByTimeAsync(10_000)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(observers.every((observer) => observer.disconnect.mock.calls.length === 1)).toBe(true)
  })

  it('discards queued diagnostics when cookie consent is revoked in another tab', async () => {
    stop = startBrowserTelemetry(true)
    reportError()
    localStorage.setItem(
      'c15t',
      JSON.stringify({ consents: { measurement: false, marketing: false } })
    )
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: 'c15t',
        oldValue: JSON.stringify({ consents: { measurement: true, marketing: false } }),
        newValue: JSON.stringify({ consents: { measurement: false, marketing: false } }),
      })
    )

    window.dispatchEvent(new Event('pagehide'))
    await vi.advanceTimersByTimeAsync(10_000)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(observers.every((observer) => observer.disconnect.mock.calls.length === 1)).toBe(true)
  })

  it('lets a durable cross-tab refusal override a failed local enable write', async () => {
    setBrowserTelemetryPreference(false)
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage full', 'QuotaExceededError')
    })
    setBrowserTelemetryPreference(true)
    stop = startBrowserTelemetry(false)
    reportError()
    write.mockRestore()
    localStorage.setItem('simstudio-telemetry-status', JSON.stringify({ enabled: false }))
    window.dispatchEvent(new StorageEvent('storage', { key: 'simstudio-telemetry-status' }))

    window.dispatchEvent(new Event('pagehide'))
    await vi.advanceTimersByTimeAsync(10_000)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(observers.every((observer) => observer.disconnect.mock.calls.length === 1)).toBe(true)
  })

  it('checks persisted Analytics permission before starting and before a pending flush', async () => {
    localStorage.setItem('c15t', JSON.stringify({ consents: { measurement: true } }))
    stop = startBrowserTelemetry(true)
    reportError()
    localStorage.setItem('c15t', JSON.stringify({ consents: { measurement: false } }))
    window.dispatchEvent(new Event('pagehide'))
    await vi.advanceTimersByTimeAsync(10_000)
    expect(fetchMock).not.toHaveBeenCalled()
    stop()
    stop = startBrowserTelemetry(true)
    reportError()
    window.dispatchEvent(new Event('pagehide'))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not carry queued events into a new grant', async () => {
    stop = startBrowserTelemetry(false)
    reportError()
    stop()
    stop = startBrowserTelemetry(false)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(fetchMock).not.toHaveBeenCalled()
    reportError()
    window.dispatchEvent(new Event('pagehide'))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).events).toHaveLength(1)
  })

  it('ignores handled errors and drops oversized batches', async () => {
    stop = startBrowserTelemetry(false)
    const handled = new ErrorEvent('error', { message: 'Handled', cancelable: true })
    handled.preventDefault()
    window.dispatchEvent(handled)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(fetchMock).not.toHaveBeenCalled()
    window.dispatchEvent(new ErrorEvent('error', { message: 'x'.repeat(65_536) }))
    window.dispatchEvent(new Event('pagehide'))
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
