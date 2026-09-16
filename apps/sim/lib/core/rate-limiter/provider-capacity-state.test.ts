/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  type ProviderCapacityConfig,
  type ProviderCapacityState,
  updateProviderCapacity,
} from '@/lib/core/rate-limiter/provider-capacity-state'

const CONFIG: ProviderCapacityConfig = {
  requestsPerMinute: 60,
  pagesPerMinute: 600,
  initialPageTokens: 30,
  maxConcurrent: 2,
  recoveryIntervalMs: 60_000,
  minimumScale: 0.05,
}
const NOW = 1_000_000
const acquire = (leaseId: string, pages = 30, leaseDurationMs = 120_000) =>
  ({ kind: 'acquire', leaseId, pages, leaseDurationMs }) as const

function initial(overrides: Partial<ProviderCapacityState> = {}): ProviderCapacityState {
  return {
    version: 1,
    scale: 1,
    nextRequestAt: 0,
    pageTokens: 600,
    refilledAt: NOW,
    cooldownUntil: 0,
    recoveryAt: NOW + 60_000,
    leases: [],
    ...overrides,
  }
}

describe('weighted provider capacity state', () => {
  it('paces from provider remaining quota without reducing healthy capacity and expires it at reset', () => {
    const state = initial({ leases: [{ id: 'first', expiresAt: NOW + 120_000 }] })
    const feedback = updateProviderCapacity(
      state,
      CONFIG,
      {
        kind: 'settle',
        leaseId: 'first',
        outcome: 'success',
        requestQuota: { remaining: 100, resetAt: NOW + 3_600_000 },
      },
      NOW
    )
    expect(feedback.state.scale).toBe(1)
    expect(feedback.state.nextRequestAt).toBe(NOW + 40_000)
    const waiting = updateProviderCapacity(feedback.state, CONFIG, acquire('next', 1), NOW + 10_000)
    expect(waiting.result).toMatchObject({ allowed: false, retryAfterMs: 30_000 })
    const admitted = updateProviderCapacity(waiting.state, CONFIG, acquire('next', 1), NOW + 40_000)
    expect(admitted.result.allowed).toBe(true)
    expect(admitted.state.requestQuota?.remaining).toBe(99)
    const reset = updateProviderCapacity(
      admitted.state,
      CONFIG,
      acquire('after-reset', 1),
      NOW + 3_600_000
    )
    expect(reset.result.allowed).toBe(true)
    expect(reset.state.requestQuota).toBeUndefined()
  })

  it('blocks every worker after successful quota exhaustion until the provider reset', () => {
    const state = initial({ leases: [{ id: 'first', expiresAt: NOW + 120_000 }] })
    const feedback = updateProviderCapacity(
      state,
      CONFIG,
      {
        kind: 'settle',
        leaseId: 'first',
        outcome: 'success',
        requestQuota: { remaining: 0, resetAt: NOW + 3_600_000 },
      },
      NOW
    )
    expect(
      updateProviderCapacity(feedback.state, CONFIG, acquire('next', 1), NOW + 60_000).result
    ).toMatchObject({ allowed: false, retryAfterMs: 3_540_000, scale: 1 })
  })

  it('never raises remaining quota from a stale response for the same window', () => {
    const state = initial({
      requestQuota: { remaining: 10, resetAt: NOW + 3_600_000 },
      leases: [{ id: 'first', expiresAt: NOW + 120_000 }],
    })
    const feedback = updateProviderCapacity(
      state,
      CONFIG,
      {
        kind: 'settle',
        leaseId: 'first',
        outcome: 'success',
        requestQuota: { remaining: 20, resetAt: NOW + 3_600_000 },
      },
      NOW
    )
    expect(feedback.state.requestQuota?.remaining).toBe(10)
    expect(state.requestQuota?.remaining).toBe(10)
    const ignored = updateProviderCapacity(
      state,
      CONFIG,
      {
        kind: 'settle',
        leaseId: 'first',
        outcome: 'success',
        requestQuota: { remaining: 200, resetAt: NOW + 1_800_000 },
      },
      NOW
    )
    expect(ignored.state.requestQuota).toEqual(state.requestQuota)
  })

  it('increases successive secondary throttle cooldowns at the provider-specific minimum', () => {
    const config = { ...CONFIG, rateLimitBackoffMs: 60_000 }
    const first = updateProviderCapacity(
      initial({ leases: [{ id: 'one', expiresAt: NOW + 120_000 }] }),
      config,
      { kind: 'settle', leaseId: 'one', outcome: 'rate_limit' },
      NOW
    )
    expect(first.result.retryAfterMs).toBe(120_000)
    const second = updateProviderCapacity(
      { ...first.state, leases: [{ id: 'two', expiresAt: NOW + 300_000 }] },
      config,
      { kind: 'settle', leaseId: 'two', outcome: 'rate_limit' },
      NOW + 120_000
    )
    expect(second.result.retryAfterMs).toBe(240_000)
  })

  it('smooths requests and spends pages only when every budget admits', () => {
    const first = updateProviderCapacity(null, CONFIG, acquire('one'), NOW)
    expect(first.result).toMatchObject({ allowed: true, inFlight: 1 })
    expect(first.state.pageTokens).toBe(0)
    const denied = updateProviderCapacity(first.state, CONFIG, acquire('two'), NOW + 500)
    expect(denied.result).toMatchObject({ allowed: false, retryAfterMs: 2500 })
    expect(denied.state.pageTokens).toBe(5)
    expect(denied.state.nextRequestAt).toBe(NOW + 1000)
    const next = updateProviderCapacity(denied.state, CONFIG, acquire('two'), NOW + 3000)
    expect(next.result).toMatchObject({ allowed: true, inFlight: 2 })
    expect(next.state.pageTokens).toBe(0)
  })

  it('caps concurrent requests without spending pages, and releases only the matching lease', () => {
    const first = updateProviderCapacity(initial(), CONFIG, acquire('one'), NOW)
    const second = updateProviderCapacity(first.state, CONFIG, acquire('two'), NOW + 1000)
    const blocked = updateProviderCapacity(second.state, CONFIG, acquire('three'), NOW + 2000)
    expect(blocked.result).toMatchObject({ allowed: false, retryAfterMs: 1000, inFlight: 2 })
    const released = updateProviderCapacity(
      blocked.state,
      CONFIG,
      { kind: 'settle', leaseId: 'one', outcome: 'failure' },
      NOW + 2000
    )
    expect(released.state.leases.map((lease) => lease.id)).toEqual(['two'])
    const admitted = updateProviderCapacity(released.state, CONFIG, acquire('three'), NOW + 2000)
    expect(admitted.result).toMatchObject({ allowed: true, inFlight: 2 })
    expect(admitted.state.pageTokens).toBe(blocked.state.pageTokens - 30)
  })

  it('reduces throughput once for concurrent 429s and respects the longest retry hint', () => {
    const first = updateProviderCapacity(initial(), CONFIG, acquire('one'), NOW)
    const second = updateProviderCapacity(first.state, CONFIG, acquire('two'), NOW + 1000)
    const feedback = updateProviderCapacity(
      second.state,
      CONFIG,
      { kind: 'settle', leaseId: 'one', outcome: 'rate_limit', retryAfterMs: 60_000 },
      NOW + 2000
    )
    expect(feedback.result).toMatchObject({ scale: 0.5, retryAfterMs: 60_000, inFlight: 1 })
    const concurrent = updateProviderCapacity(
      feedback.state,
      CONFIG,
      { kind: 'settle', leaseId: 'two', outcome: 'rate_limit', retryAfterMs: 120_000 },
      NOW + 2500
    )
    expect(concurrent.result).toMatchObject({ scale: 0.5, retryAfterMs: 120_000, inFlight: 0 })
    expect(concurrent.state.pageTokens).toBe(0)
    const denied = updateProviderCapacity(concurrent.state, CONFIG, acquire('three'), NOW + 60_000)
    expect(denied.result).toMatchObject({ allowed: false, retryAfterMs: 62_500 })
  })

  it('recovers gradually only after a successful request and the recovery interval', () => {
    const state = initial({
      scale: 0.5,
      recoveryAt: NOW + 60_000,
      leases: [
        { id: 'one', expiresAt: NOW + 120_000 },
        { id: 'two', expiresAt: NOW + 120_000 },
      ],
    })
    const recovered = updateProviderCapacity(
      state,
      CONFIG,
      { kind: 'settle', leaseId: 'one', outcome: 'success' },
      NOW + 60_000
    )
    expect(recovered.state.scale).toBe(0.55)
    const concurrent = updateProviderCapacity(
      recovered.state,
      CONFIG,
      { kind: 'settle', leaseId: 'two', outcome: 'success' },
      NOW + 60_000
    )
    expect(concurrent.state.scale).toBe(0.55)
    const failed = updateProviderCapacity(
      initial({ scale: 0.5, recoveryAt: NOW, leases: [{ id: 'one', expiresAt: NOW + 1000 }] }),
      CONFIG,
      { kind: 'settle', leaseId: 'one', outcome: 'failure' },
      NOW
    )
    expect(failed.state.scale).toBe(0.5)
  })

  it('expires crash leases, preserves the minimum scale, and caps accumulated page credit', () => {
    const state = initial({
      scale: 0.001,
      pageTokens: 50_000,
      leases: [{ id: 'crashed', expiresAt: NOW - 1 }],
    })
    const result = updateProviderCapacity(state, CONFIG, acquire('new'), NOW)
    expect(result.result).toMatchObject({ allowed: true, inFlight: 1, scale: 0.05 })
    expect(result.state.pageTokens).toBe(570)
    expect(result.state.leases[0]).toEqual({ id: 'new', expiresAt: NOW + 120_000 })
  })

  it('never double-spends a repeated lease and ignores duplicate or expired feedback', () => {
    const first = updateProviderCapacity(null, CONFIG, acquire('one'), NOW)
    const duplicate = updateProviderCapacity(first.state, CONFIG, acquire('one'), NOW)
    expect(duplicate.state.pageTokens).toBe(0)
    expect(duplicate.state.leases).toHaveLength(1)
    expect(duplicate.result.allowed).toBe(true)
    const expired = updateProviderCapacity(
      first.state,
      CONFIG,
      { kind: 'settle', leaseId: 'one', outcome: 'rate_limit' },
      NOW + 120_000
    )
    expect(expired.result).toMatchObject({ allowed: false, scale: 1, inFlight: 0 })
  })

  it('uses a monotonic clock for every transition after the backend clock moves backward', () => {
    const state = initial({
      scale: 0.5,
      pageTokens: 60,
      recoveryAt: NOW,
      leases: [{ id: 'held', expiresAt: NOW + 60_000 }],
    })
    const actions = [
      acquire('new'),
      { kind: 'settle', leaseId: 'held', outcome: 'rate_limit', retryAfterMs: 60_000 },
      { kind: 'settle', leaseId: 'held', outcome: 'success' },
    ] as const
    for (const action of actions) {
      expect(updateProviderCapacity(state, CONFIG, action, NOW - 30_000)).toEqual(
        updateProviderCapacity(state, CONFIG, action, NOW)
      )
    }
  })

  it('rounds adaptive deadlines up to whole milliseconds without advancing admission', () => {
    const admitted = updateProviderCapacity(initial({ scale: 0.55 }), CONFIG, acquire('one'), NOW)
    expect(admitted.state.nextRequestAt).toBe(NOW + 1819)
    expect(
      updateProviderCapacity(admitted.state, CONFIG, acquire('two'), NOW + 1818).result
    ).toMatchObject({
      allowed: false,
      retryAfterMs: 1,
    })
    expect(
      updateProviderCapacity(admitted.state, CONFIG, acquire('two'), NOW + 1819).result.allowed
    ).toBe(true)
  })

  it('applies lower operating budgets to existing state without resetting adaptive feedback or leases', () => {
    const state = initial({
      scale: 0.5,
      pageTokens: 600,
      leases: [
        { id: 'old-one', expiresAt: NOW + 60_000 },
        { id: 'old-two', expiresAt: NOW + 60_000 },
      ],
    })
    const config = { ...CONFIG, pagesPerMinute: 60, requestsPerMinute: 6, maxConcurrent: 1 }
    const blocked = updateProviderCapacity(state, config, acquire('new'), NOW)
    expect(blocked.result).toMatchObject({ allowed: false, scale: 0.5, inFlight: 2 })
    expect(blocked.state.pageTokens).toBe(60)
    const first = updateProviderCapacity(
      blocked.state,
      config,
      { kind: 'settle', leaseId: 'old-one', outcome: 'failure' },
      NOW
    )
    expect(updateProviderCapacity(first.state, config, acquire('new'), NOW).result.allowed).toBe(
      false
    )
    const second = updateProviderCapacity(
      first.state,
      config,
      { kind: 'settle', leaseId: 'old-two', outcome: 'failure' },
      NOW
    )
    const admitted = updateProviderCapacity(second.state, config, acquire('new'), NOW)
    expect(admitted.result.allowed).toBe(true)
    expect(admitted.state.nextRequestAt).toBe(NOW + 20_000)
    expect(admitted.state.pageTokens).toBe(30)
  })

  it('caps page admissions in every rolling minute after an idle bucket fills', () => {
    const config = { ...CONFIG, pagesPerMinute: 1000, initialPageTokens: 1000, maxConcurrent: 64 }
    let state: ProviderCapacityState | null = null
    let admittedPages = 0
    for (let second = 0; second < 60; second++) {
      const update = updateProviderCapacity(
        state,
        config,
        acquire(`request-${second}`),
        NOW + second * 1000
      )
      state = update.state
      if (update.result.allowed) admittedPages += 30
    }
    expect(admittedPages).toBe(990)
    const blocked = updateProviderCapacity(state, config, acquire('next'), NOW + 60_000)
    expect(blocked.state.pageTokens).toBeGreaterThanOrEqual(30)
    expect(blocked.result).toMatchObject({ allowed: false, retryAfterMs: 1000 })
    const admitted = updateProviderCapacity(blocked.state, config, acquire('next'), NOW + 61_000)
    expect(admitted.result.allowed).toBe(true)
    expect(admitted.state.pageWindow?.reduce((total, bucket) => total + bucket.pages, 0)).toBe(990)
  })

  it('waits until enough mixed-cost buckets expire without refunding completed requests', () => {
    const config = { ...CONFIG, pagesPerMinute: 1000, initialPageTokens: 1000, maxConcurrent: 64 }
    let state: ProviderCapacityState | null = null
    for (const [id, pages, elapsed] of [
      ['large', 700, 900],
      ['small', 100, 2000],
      ['medium', 200, 5000],
    ] as const) {
      const admitted = updateProviderCapacity(state, config, acquire(id, pages), NOW + elapsed)
      expect(admitted.result.allowed).toBe(true)
      state = updateProviderCapacity(
        admitted.state,
        config,
        { kind: 'settle', leaseId: id, outcome: 'success' },
        NOW + elapsed
      ).state
    }
    const blocked = updateProviderCapacity(state, config, acquire('next', 750), NOW + 30_000)
    expect(blocked.result).toMatchObject({ allowed: false, retryAfterMs: 33_000 })
    expect(
      updateProviderCapacity(blocked.state, config, acquire('next', 750), NOW + 62_999).result
    ).toMatchObject({
      allowed: false,
      retryAfterMs: 1,
    })
    const admitted = updateProviderCapacity(
      blocked.state,
      config,
      acquire('next', 750),
      NOW + 63_000
    )
    expect(admitted.result.allowed).toBe(true)
    expect(admitted.state.pageWindow?.reduce((total, bucket) => total + bucket.pages, 0)).toBe(950)
  })

  it('combines admissions per second and bounds rolling history to 61 buckets', () => {
    const config = { ...CONFIG, requestsPerMinute: 60_000 }
    const first = updateProviderCapacity(null, config, acquire('first', 1, 1), NOW)
    const second = updateProviderCapacity(first.state, config, acquire('second', 1, 1), NOW + 1)
    expect(second.result.allowed).toBe(true)
    expect(second.state.pageWindow).toEqual([{ at: NOW, pages: 2 }])
    expect(first.state.pageWindow).toEqual([{ at: NOW, pages: 1 }])
    let state = second.state
    for (let second = 1; second <= 120; second++) {
      const update = updateProviderCapacity(
        state,
        config,
        acquire(`request-${second}`, 1, 1),
        NOW + second * 1000
      )
      expect(update.result.allowed).toBe(true)
      expect(update.state.pageWindow!.length).toBeLessThanOrEqual(61)
      state = update.state
    }
    expect(state.pageWindow).toHaveLength(61)
  })

  it('uses the base rolling ceiling so an adaptive slowdown cannot deadlock a full-budget request', () => {
    const state = initial({ scale: 0.5, pageTokens: 0 })
    const blocked = updateProviderCapacity(state, CONFIG, acquire('full', 600), NOW)
    expect(blocked.result).toMatchObject({ allowed: false, retryAfterMs: 120_000 })
    const admitted = updateProviderCapacity(
      blocked.state,
      CONFIG,
      acquire('full', 600),
      NOW + 120_000
    )
    expect(admitted.result).toMatchObject({ allowed: true, scale: 0.5 })
    expect(admitted.state.pageWindow).toEqual([{ at: NOW + 120_000, pages: 600 }])
  })

  it('preserves rolling usage through backend clock rollback and duplicate admission', () => {
    const first = updateProviderCapacity(null, CONFIG, acquire('first'), NOW + 30_000)
    const duplicate = updateProviderCapacity(first.state, CONFIG, acquire('first'), NOW)
    expect(duplicate.state.pageWindow).toEqual(first.state.pageWindow)
    const state = initial({ refilledAt: NOW + 30_000, pageWindow: [{ at: NOW, pages: 600 }] })
    const blocked = updateProviderCapacity(state, CONFIG, acquire('new'), NOW)
    expect(blocked.result).toMatchObject({ allowed: false, retryAfterMs: 31_000 })
    expect(blocked.state.pageWindow).toEqual(state.pageWindow)
  })
})
