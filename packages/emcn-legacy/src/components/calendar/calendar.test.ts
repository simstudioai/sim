import { describe, expect, it, vi } from 'vitest'
import { buildRangeBounds, parseDateTimeValue } from './calendar'

describe('parseDateTimeValue', () => {
  it('keeps the time of T datetime strings, even at exactly midnight', () => {
    expect(parseDateTimeValue('2026-07-07T00:00:00').time).toBe('00:00')
    expect(parseDateTimeValue('2026-07-06T16:04:55').time).toBe('16:04:55')
    expect(parseDateTimeValue('2026-07-06T16:04').time).toBe('16:04')
  })

  it.each(['14:30:00.000001', '14:30:45.123456', '00:00:00.999999', '14:30:45.123456789'])(
    'retains the full wall time %s for subsequent date selections',
    (time) => {
      expect(parseDateTimeValue(`2026-09-07T${time}`).time).toBe(time)
    }
  )

  it.each([
    ['2026-09-07T07:30:45.123456Z', '07:30:45'],
    ['2026-09-07T07:30:45.123456-07:00', '14:30:45'],
    ['2026-09-07T07:30:45.123456+05:45', '01:45:45'],
  ])('keeps explicit-offset input %s on the instant conversion path', (value, expectedTime) => {
    vi.stubEnv('TZ', 'UTC')
    try {
      expect(parseDateTimeValue(value).time).toBe(expectedTime)
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('does not reinterpret a literal wall time through a daylight-saving gap', () => {
    expect(parseDateTimeValue('2026-03-08T02:30:45.123456').time).toBe('02:30:45.123456')
  })
})

describe('buildRangeBounds', () => {
  it('orders inverted bounds', () => {
    const bounds = buildRangeBounds(new Date(2026, 3, 30), new Date(2026, 3, 1), {
      showTime: false,
      startTime: '00:00',
      endTime: '23:59',
    })
    expect(bounds).toEqual({ start: '2026-04-01', end: '2026-04-30' })
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
