import { describe, expect, it } from 'vitest'
import {
  formatInstantInTimeZone,
  getSupportedTimezones,
  getTimezoneOptions,
  getWallClockParts,
  wallClockNow,
  zonedClockDate,
  zonedWallClockToUtc,
  zonedWallClockWithOffset,
} from './timezone'

describe('formatInstantInTimeZone', () => {
  it.each([
    ['UTC', '2026-06-15T00:15:30Z', '2026-06-15T00:15:30Z'],
    ['America/Los_Angeles', '2026-06-15T00:15:30Z', '2026-06-14T17:15:30-07:00'],
    ['Asia/Tokyo', '2026-06-15T00:15:30Z', '2026-06-15T09:15:30+09:00'],
    ['Asia/Kathmandu', '2026-06-15T00:15:30Z', '2026-06-15T06:00:30+05:45'],
    ['Australia/Lord_Howe', '2026-06-15T00:15:30Z', '2026-06-15T10:45:30+10:30'],
  ])('formats an instant in %s with its exact offset', (timeZone, iso, expected) => {
    expect(formatInstantInTimeZone(new Date(iso), timeZone)).toBe(expected)
  })

  it('distinguishes both copies of an autumn daylight-saving hour', () => {
    expect(formatInstantInTimeZone(new Date('2026-11-01T05:30:00Z'), 'America/New_York')).toBe(
      '2026-11-01T01:30:00-04:00'
    )
    expect(formatInstantInTimeZone(new Date('2026-11-01T06:30:00Z'), 'America/New_York')).toBe(
      '2026-11-01T01:30:00-05:00'
    )
  })

  it('round-trips the same instant after changing display timezones', () => {
    const instant = new Date('2026-11-01T06:30:00Z')
    for (const timeZone of [
      'UTC',
      'America/Los_Angeles',
      'America/New_York',
      'Asia/Kathmandu',
      'Australia/Lord_Howe',
    ]) {
      const editable = formatInstantInTimeZone(instant, timeZone)
      expect(new Date(editable).getTime()).toBe(instant.getTime())
    }
  })
})

describe('getWallClockParts', () => {
  it('returns the calendar fields of an instant in the requested timezone', () => {
    expect(getWallClockParts(new Date('2026-06-15T00:15:30Z'), 'America/Los_Angeles')).toEqual({
      year: 2026,
      month: 6,
      day: 14,
      hour: 17,
      minute: 15,
      second: 30,
    })
  })
})

describe('zonedWallClockToUtc', () => {
  it('treats a UTC wall-clock as the same instant', () => {
    expect(zonedWallClockToUtc('2026-06-15T09:00', 'UTC').toISOString()).toBe(
      '2026-06-15T09:00:00.000Z'
    )
  })

  it('applies a positive (east-of-UTC) offset (Asia/Kolkata, UTC+5:30)', () => {
    expect(zonedWallClockToUtc('2026-06-15T09:00', 'Asia/Kolkata').toISOString()).toBe(
      '2026-06-15T03:30:00.000Z'
    )
  })

  it('honors DST: America/New_York is UTC-4 in summer, UTC-5 in winter', () => {
    expect(zonedWallClockToUtc('2026-06-15T09:00', 'America/New_York').toISOString()).toBe(
      '2026-06-15T13:00:00.000Z'
    )
    expect(zonedWallClockToUtc('2026-01-15T09:00', 'America/New_York').toISOString()).toBe(
      '2026-01-15T14:00:00.000Z'
    )
  })

  it('preserves seconds when present', () => {
    expect(zonedWallClockToUtc('2026-07-01T23:59:59', 'UTC').toISOString()).toBe(
      '2026-07-01T23:59:59.000Z'
    )
  })

  it('resolves a wall-clock on the autumn DST fall-back day at the correct offset', () => {
    // America/New_York falls back EDT(-4)→EST(-5) at 2026-11-01 06:00Z. A naive
    // single-pass offset read lands these an hour early; the two-pass resolve
    // settles on EST (-5) for these post-transition wall clocks.
    expect(zonedWallClockToUtc('2026-11-01T02:00', 'America/New_York').toISOString()).toBe(
      '2026-11-01T07:00:00.000Z'
    )
    expect(zonedWallClockToUtc('2026-11-01T05:00', 'America/New_York').toISOString()).toBe(
      '2026-11-01T10:00:00.000Z'
    )
  })

  it('resolves a spring-forward gap wall-clock forward by the DST shift', () => {
    const instant = zonedWallClockToUtc('2026-03-08T02:30', 'America/New_York')
    const stampedWallClock = zonedWallClockWithOffset('2026-03-08T02:30', 'America/New_York')

    expect(instant.toISOString()).toBe('2026-03-08T07:30:00.000Z')
    expect(stampedWallClock).toBe('2026-03-08T02:30-05:00')
    expect(new Date(stampedWallClock).toISOString()).toBe(instant.toISOString())
  })

  it.each([
    [
      'Europe/Berlin',
      '2026-03-29T02:30',
      '2026-03-29T01:30:00.000Z',
      '2026-03-29T03:30:00+02:00',
      '2026-03-29T02:30+01:00',
    ],
    [
      'Australia/Lord_Howe',
      '2026-10-04T02:15',
      '2026-10-03T15:45:00.000Z',
      '2026-10-04T02:45:00+11:00',
      '2026-10-04T02:15+10:30',
    ],
  ])(
    'resolves an east-of-UTC spring-forward gap in %s to the first compatible wall-clock',
    (timeZone, wallClock, expectedInstant, expectedRenderedWallClock, expectedStampedWallClock) => {
      const instant = zonedWallClockToUtc(wallClock, timeZone)
      const stampedWallClock = zonedWallClockWithOffset(wallClock, timeZone)

      expect(instant.toISOString()).toBe(expectedInstant)
      expect(formatInstantInTimeZone(instant, timeZone)).toBe(expectedRenderedWallClock)
      expect(stampedWallClock).toBe(expectedStampedWallClock)
      expect(new Date(stampedWallClock).toISOString()).toBe(expectedInstant)
    }
  )

  it.each([
    ['America/New_York', '2026-11-01T01:30', '2026-11-01T06:30:00.000Z', '-05:00'],
    ['Europe/Berlin', '2026-10-25T02:30', '2026-10-25T01:30:00.000Z', '+01:00'],
    ['Australia/Lord_Howe', '2026-04-05T01:45', '2026-04-04T15:15:00.000Z', '+10:30'],
  ])(
    'chooses the later post-transition instant for an ambiguous fall-back wall-clock in %s',
    (timeZone, wallClock, expectedInstant, expectedOffset) => {
      const instant = zonedWallClockToUtc(wallClock, timeZone)
      const stampedWallClock = zonedWallClockWithOffset(wallClock, timeZone)

      expect(instant.toISOString()).toBe(expectedInstant)
      expect(stampedWallClock).toBe(`${wallClock}${expectedOffset}`)
      expect(new Date(stampedWallClock).toISOString()).toBe(expectedInstant)
    }
  )
})

describe('wallClockNow', () => {
  it('returns a naive yyyy-MM-ddTHH:mm string', () => {
    expect(wallClockNow('UTC')).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
  })
})

describe('getSupportedTimezones', () => {
  it('always returns a non-empty list including UTC', () => {
    const zones = getSupportedTimezones()
    expect(zones.length).toBeGreaterThan(0)
    expect(zones).toContain('UTC')
  })
})

describe('getTimezoneOptions', () => {
  it('renders every zone as "City (GMT±HH:MM)"', () => {
    const options = getTimezoneOptions()
    expect(options.length).toBeGreaterThan(0)
    for (const option of options) {
      expect(option.label).toMatch(/^.+ \(GMT[+-]\d{2}:\d{2}\)$/)
    }
  })

  it('orders zones alphabetically by city', () => {
    const cities = getTimezoneOptions().map((option) =>
      option.label.replace(/ \(GMT[+-]\d{2}:\d{2}\)$/, '')
    )
    expect(cities).toEqual([...cities].sort((a, b) => a.localeCompare(b)))
  })

  it('uses a live DST-aware offset and a friendly city', () => {
    const options = getTimezoneOptions()
    expect(options.find((o) => o.value === 'UTC')?.label).toBe('UTC (GMT+00:00)')
    // India has no DST, so this offset is stable regardless of when the test runs.
    expect(
      options.find((o) => o.value === 'Asia/Kolkata' || o.value === 'Asia/Calcutta')?.label
    ).toMatch(/^(Kolkata|Calcutta) \(GMT\+05:30\)$/)
  })

  it('has no duplicate values', () => {
    const values = getTimezoneOptions().map((o) => o.value)
    expect(new Set(values).size).toBe(values.length)
  })
})

describe('zonedClockDate', () => {
  const instant = new Date('2026-06-15T13:00:00.000Z')

  it('exposes the zone wall-clock through device-local fields', () => {
    const ny = zonedClockDate(instant, 'America/New_York')
    expect(ny.getHours()).toBe(9)
    expect(ny.getMinutes()).toBe(0)
    expect(ny.getDate()).toBe(15)
  })

  it('rolls the date when the zone is on the other side of midnight', () => {
    const tokyo = zonedClockDate(instant, 'Asia/Tokyo')
    expect(tokyo.getDate()).toBe(15)
    expect(tokyo.getHours()).toBe(22)

    const earlyUtc = new Date('2026-06-15T01:00:00.000Z')
    const la = zonedClockDate(earlyUtc, 'America/Los_Angeles')
    expect(la.getDate()).toBe(14)
    expect(la.getHours()).toBe(18)
  })
})
