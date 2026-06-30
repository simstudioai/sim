/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { buildRangeBounds, formatDateRangeLabel, parseDateValue } from './calendar'

describe('parseDateValue', () => {
  it('parses a YYYY-MM-DD string as a local day', () => {
    const date = parseDateValue('2026-04-21')
    expect(date?.getFullYear()).toBe(2026)
    expect(date?.getMonth()).toBe(3)
    expect(date?.getDate()).toBe(21)
  })

  it('parses the day from a YYYY-MM-DDTHH:mm string', () => {
    const date = parseDateValue('2026-04-21T09:30')
    expect(date?.getMonth()).toBe(3)
    expect(date?.getDate()).toBe(21)
  })

  it('returns null for empty or invalid input', () => {
    expect(parseDateValue(undefined)).toBeNull()
    expect(parseDateValue('not-a-date')).toBeNull()
  })
})

describe('buildRangeBounds', () => {
  it('serializes bare days when time is off', () => {
    const bounds = buildRangeBounds(new Date(2026, 3, 1), new Date(2026, 3, 30), {
      showTime: false,
      startTime: '00:00',
      endTime: '23:59',
    })
    expect(bounds).toEqual({ start: '2026-04-01', end: '2026-04-30' })
  })

  it('orders inverted bounds', () => {
    const bounds = buildRangeBounds(new Date(2026, 3, 30), new Date(2026, 3, 1), {
      showTime: false,
      startTime: '00:00',
      endTime: '23:59',
    })
    expect(bounds).toEqual({ start: '2026-04-01', end: '2026-04-30' })
  })

  it('appends start time and closes the end at :59 when time is on', () => {
    const bounds = buildRangeBounds(new Date(2026, 3, 1), new Date(2026, 3, 2), {
      showTime: true,
      startTime: '09:00',
      endTime: '17:30',
    })
    expect(bounds).toEqual({ start: '2026-04-01T09:00', end: '2026-04-02T17:30:59' })
  })

  it('swaps inverted times on a single day', () => {
    const bounds = buildRangeBounds(new Date(2026, 3, 1), new Date(2026, 3, 1), {
      showTime: true,
      startTime: '18:00',
      endTime: '09:00',
    })
    expect(bounds).toEqual({ start: '2026-04-01T09:00', end: '2026-04-01T18:00:59' })
  })
})

describe('formatDateRangeLabel', () => {
  it('renders a same-year range compactly', () => {
    expect(formatDateRangeLabel('2026-04-08', '2026-04-12')).toBe('Apr 8 - Apr 12, 2026')
  })

  it('shows both years when they differ', () => {
    expect(formatDateRangeLabel('2025-12-30', '2026-01-02')).toBe('Dec 30, 2025 - Jan 2, 2026')
  })

  it('falls back to a single label when only one bound is set', () => {
    expect(formatDateRangeLabel('2026-04-08', undefined)).toBe('Apr 8, 2026')
    expect(formatDateRangeLabel(undefined, undefined)).toBe('')
  })
})
