/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cacheLargeValue,
  clearLargeValueCacheForTests,
  getLargeValueCacheStats,
  materializeLargeValueRefSync,
} from '@/lib/execution/payloads/cache'
import {
  LARGE_VALUE_REF_VERSION,
  type LargeValueRef,
} from '@/lib/execution/payloads/large-value-ref'

const MB = 1024 * 1024
const SCOPE = { executionId: 'exec-1' }

function makeRef(id: string, size: number): LargeValueRef {
  return {
    __simLargeValueRef: true,
    version: LARGE_VALUE_REF_VERSION,
    id,
    kind: 'object',
    size,
    executionId: 'exec-1',
  }
}

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

describe('large value cache retention policy', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    clearLargeValueCacheForTests()
  })

  afterEach(() => {
    clearLargeValueCacheForTests()
    vi.useRealTimers()
  })

  it('refreshes the idle TTL on every read so in-use values outlive the absolute window', () => {
    cacheLargeValue('lv_touchedvalue', { data: 'v' }, 32, SCOPE)

    vi.advanceTimersByTime(10 * 60 * 1000)
    expect(materializeLargeValueRefSync(makeRef('lv_touchedvalue', 32), SCOPE)).toEqual({
      data: 'v',
    })

    vi.advanceTimersByTime(10 * 60 * 1000)
    expect(materializeLargeValueRefSync(makeRef('lv_touchedvalue', 32), SCOPE)).toEqual({
      data: 'v',
    })

    vi.advanceTimersByTime(16 * 60 * 1000)
    expect(materializeLargeValueRefSync(makeRef('lv_touchedvalue', 32), SCOPE)).toBeUndefined()
  })

  it('pressure-evicts the least-recently-read recoverable entry, not the oldest-inserted', () => {
    cacheLargeValue('lv_aaaaaaaaaaaa', { name: 'a' }, 120 * MB, SCOPE, { recoverable: true })
    cacheLargeValue('lv_bbbbbbbbbbbb', { name: 'b' }, 120 * MB, SCOPE, { recoverable: true })

    expect(materializeLargeValueRefSync(makeRef('lv_aaaaaaaaaaaa', 120 * MB), SCOPE)).toEqual({
      name: 'a',
    })

    expect(
      cacheLargeValue('lv_cccccccccccc', { name: 'c' }, 60 * MB, SCOPE, { recoverable: true })
    ).toBe(true)

    expect(materializeLargeValueRefSync(makeRef('lv_aaaaaaaaaaaa', 120 * MB), SCOPE)).toEqual({
      name: 'a',
    })
    expect(
      materializeLargeValueRefSync(makeRef('lv_bbbbbbbbbbbb', 120 * MB), SCOPE)
    ).toBeUndefined()
    expect(getLargeValueCacheStats()).toEqual({ entries: 2, trackedBytes: 180 * MB })
  })

  it('never pressure-evicts a sole-copy entry; admission fails instead', () => {
    cacheLargeValue('lv_nnnnnnnnnnnn', { name: 'sole-copy' }, 200 * MB, SCOPE)

    expect(
      cacheLargeValue('lv_rrrrrrrrrrrr', { name: 'r' }, 100 * MB, SCOPE, { recoverable: true })
    ).toBe(false)

    expect(materializeLargeValueRefSync(makeRef('lv_nnnnnnnnnnnn', 200 * MB), SCOPE)).toEqual({
      name: 'sole-copy',
    })
    expect(getLargeValueCacheStats()).toEqual({ entries: 1, trackedBytes: 200 * MB })
  })
})
