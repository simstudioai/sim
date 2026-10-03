import { formatTimeTick, resolveSpanMs, resolveTimeTickIndices } from '@sim/emcn'
import { describe, expect, it } from 'vitest'

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
