import {
  formatTimeTick,
  resolveBarTickValues,
  resolveSpanMs,
  resolveTimeTickIndices,
} from '@sim/emcn'
import { describe, expect, it } from 'vitest'

describe('resolveBarTickValues', () => {
  it.each([
    [620_000, [0, 200_000, 400_000, 600_000, 800_000]],
    [1, [0, 1, 2]],
    [0.6, [0, 0.2, 0.4, 0.6, 0.8]],
  ])('keeps readable ticks and headroom above a peak of %s', (peak, expected) => {
    expect(resolveBarTickValues(peak)).toEqual(expected)
  })

  it.each([Number.MIN_VALUE, 1e-323, 2e-323, 1.5e308, Number.MAX_VALUE])(
    'keeps a finite, increasing scale covering an extreme finite peak of %s',
    (peak) => {
      const ticks = resolveBarTickValues(peak)
      expect(ticks.length).toBeGreaterThanOrEqual(2)
      expect(ticks.length).toBeLessThanOrEqual(6)
      expect(ticks[0]).toBe(0)
      expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(peak)
      expect(ticks.every(Number.isFinite)).toBe(true)
      expect(ticks.every((tick, index) => index === 0 || tick > ticks[index - 1])).toBe(true)
    }
  )

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'provides a finite, nonzero scale for an empty or invalid peak of %s',
    (peak) => {
      const ticks = resolveBarTickValues(peak)
      expect(ticks[0]).toBe(0)
      expect(ticks[ticks.length - 1]).toBeGreaterThan(0)
      expect(ticks.every(Number.isFinite)).toBe(true)
    }
  )
})

describe('resolveTimeTickIndices', () => {
  it('dedupes the collisions rounding produces on a short series', () => {
    /** 2 points across a wide chart wants 8 ticks but only has indices 0 and 1. */
    const indices = resolveTimeTickIndices(2, 4000)
    expect(indices).toEqual([...new Set(indices)])
    expect(indices.every((index) => index >= 0 && index < 2)).toBe(true)
  })
})

describe('resolveSpanMs', () => {
  it('returns 0 for a degenerate or unparseable series rather than NaN', () => {
    expect(resolveSpanMs([])).toBe(0)
    expect(resolveSpanMs([{ timestamp: '2026-03-04T00:00:00.000Z' }])).toBe(0)
    expect(resolveSpanMs([{ timestamp: 'nope' }, { timestamp: 'also nope' }])).toBe(0)
  })
})

it('keeps UTC bucket labels independent of the viewer time zone', () => {
  const bucket = new Date('2026-09-10T00:00:00.000Z')
  expect(formatTimeTick(bucket, 7 * 24 * 60 * 60 * 1000, 'UTC')).toBe('Sep 10')
  expect(formatTimeTick(bucket, 7 * 24 * 60 * 60 * 1000, 'America/Los_Angeles')).toBe('Sep 9')
})
