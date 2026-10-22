/**
 * Failure modes guarded here:
 * - Next instantiates this file once per bundle graph (instrumentation vs each
 *   route), so per-module state would leave the telemetry reader seeing an
 *   empty registry while routes write to their own copy.
 * - Request ids repeat when route wrappers nest, so keying entries by request id
 *   lets the inner settle erase the outer entry.
 * - A handler that never settles must not grow the registry without bound.
 * - A synchronous burst settles its own request a few milliseconds before the
 *   stall probe runs, so a near-zero tolerance never reports it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type InFlightModule = typeof import('@/lib/monitoring/in-flight-requests')

async function loadFreshModuleInstance(): Promise<InFlightModule> {
  vi.resetModules()
  return import('@/lib/monitoring/in-flight-requests')
}

describe('in-flight request registry', () => {
  beforeEach(() => {
    for (const key of Object.keys(globalThis)) {
      if (key.startsWith('_simInFlight')) Reflect.deleteProperty(globalThis, key)
    }
  })

  it('shares state between separately instantiated copies of the module', async () => {
    const routeInstance = await loadFreshModuleInstance()
    const telemetryInstance = await loadFreshModuleInstance()
    expect(routeInstance).not.toBe(telemetryInstance)

    const settle = routeInstance.trackInFlightRequest('req-1', 'POST', '/api/a')
    expect(telemetryInstance.getInFlightCount()).toBe(1)

    settle()
    expect(telemetryInstance.getInFlightCount()).toBe(0)
  })

  it('keeps an outer entry when a nested wrapper reuses the same request id', async () => {
    const registry = await loadFreshModuleInstance()
    const settleOuter = registry.trackInFlightRequest('req-1', 'POST', '/api/a')
    const settleInner = registry.trackInFlightRequest('req-1', 'POST', '/api/a')

    settleInner()
    expect(registry.getInFlightCount()).toBe(1)

    settleOuter()
    expect(registry.getInFlightCount()).toBe(0)
  })

  it('bounds the registry when handlers never settle', async () => {
    const registry = await loadFreshModuleInstance()
    for (let i = 0; i < 10_000; i++) registry.trackInFlightRequest(`req-${i}`, 'GET', '/api/hang')

    const tracked = registry.getInFlightCount()
    expect(tracked).toBeLessThan(10_000)
    expect(registry.takeInFlightWindow().dropped).toBe(10_000 - tracked)
  })

  it('reports a request that settled shortly before the stall was observed', async () => {
    const registry = await loadFreshModuleInstance()
    const settle = registry.trackInFlightRequest('req-burst', 'POST', '/api/burst')
    const stallStart = performance.now()
    settle()
    const stallEnd = performance.now() + 20

    const spanning = registry.findRequestsSpanningStall(stallStart, stallEnd)
    expect(spanning.map((entry) => entry.requestId)).toEqual(['req-burst'])
    expect(spanning[0].finished).toBe(true)
  })

  it('reports a request that started just after the probe was due, but not one queued behind the stall', async () => {
    vi.useFakeTimers({ toFake: ['performance'] })
    try {
      const registry = await loadFreshModuleInstance()
      const probeDue = performance.now()
      vi.advanceTimersByTime(20)
      const settleBlocker = registry.trackInFlightRequest('req-blocker', 'POST', '/api/blocker')
      vi.advanceTimersByTime(1_500)
      settleBlocker()
      const settleQueued = registry.trackInFlightRequest('req-queued', 'GET', '/api/queued')
      vi.advanceTimersByTime(5)
      settleQueued()
      vi.advanceTimersByTime(5)

      const spanning = registry.findRequestsSpanningStall(probeDue, performance.now())
      expect(spanning.map((entry) => entry.requestId)).toEqual(['req-blocker'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not report a request that finished well before the stall ended', async () => {
    const registry = await loadFreshModuleInstance()
    const settle = registry.trackInFlightRequest('req-early', 'GET', '/api/early')
    const stallStart = performance.now()
    settle()

    expect(registry.findRequestsSpanningStall(stallStart, performance.now() + 500)).toEqual([])
  })
})
