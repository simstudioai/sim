import { afterEach, describe, expect, it, vi } from 'vitest'
import { backoffWithJitter } from './retry'

/** Pins the jitter draw: 0 is its low end, just under 2^32 its high end. */
function drawJitter(value: number) {
  vi.spyOn(crypto, 'getRandomValues').mockImplementation((array) => {
    if (array instanceof Uint32Array) array[0] = value
    return array
  })
}

describe('backoffWithJitter', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('never waits longer than maxMs, however high the jitter draws at the cap', () => {
    drawJitter(0xffffffff)
    expect(backoffWithJitter(10, null, { baseMs: 500, maxMs: 2000 })).toBeLessThanOrEqual(2000)
  })

  it('still spreads a delay below the cap both ways', () => {
    drawJitter(0)
    expect(backoffWithJitter(1, null, { baseMs: 1000, maxMs: 30_000 })).toBe(800)
    drawJitter(0xffffffff)
    expect(backoffWithJitter(1, null, { baseMs: 1000, maxMs: 30_000 })).toBeCloseTo(1200, 0)
  })
})
