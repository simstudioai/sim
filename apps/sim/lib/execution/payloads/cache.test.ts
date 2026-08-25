/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cacheLargeValue,
  clearLargeValueCacheForTests,
  getLargeValueCacheStats,
} from '@/lib/execution/payloads/cache'

describe('large value cache sweep', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    clearLargeValueCacheForTests()
  })

  afterEach(() => {
    clearLargeValueCacheForTests()
    vi.useRealTimers()
  })

  it('drains expired entries without further cache traffic', () => {
    expect(
      cacheLargeValue('lv_sweep', { data: 'x'.repeat(64) }, 64, { executionId: 'exec-1' })
    ).toBe(true)
    expect(getLargeValueCacheStats()).toEqual({ entries: 1, trackedBytes: 64 })

    vi.advanceTimersByTime(16 * 60 * 1000)

    expect(getLargeValueCacheStats()).toEqual({ entries: 0, trackedBytes: 0 })
  })

  it('retires the sweep timer once the cache drains and re-arms on the next insert', () => {
    cacheLargeValue('lv_a', { data: 1 }, 8, { executionId: 'exec-1' })
    expect(vi.getTimerCount()).toBe(1)

    vi.advanceTimersByTime(16 * 60 * 1000)
    expect(vi.getTimerCount()).toBe(0)

    cacheLargeValue('lv_b', { data: 2 }, 8, { executionId: 'exec-1' })
    expect(vi.getTimerCount()).toBe(1)
  })

  it('keeps unexpired entries readable across sweep ticks', () => {
    cacheLargeValue('lv_live', { data: 'live' }, 16, { executionId: 'exec-1' })

    vi.advanceTimersByTime(5 * 60 * 1000)

    expect(getLargeValueCacheStats()).toEqual({ entries: 1, trackedBytes: 16 })
  })
})
