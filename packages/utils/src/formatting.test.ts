/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  formatAbsoluteDate,
  formatCompactTimestamp,
  formatDate,
  formatDateTime,
  formatDuration,
  formatRelativeTime,
  formatTime,
  formatTimeWithSeconds,
  getTimezoneAbbreviation,
} from './formatting.js'

describe('getTimezoneAbbreviation', () => {
  it('returns UTC for UTC timezone', () => {
    expect(getTimezoneAbbreviation('UTC')).toBe('UTC')
  })

  it('returns JST for Tokyo (no DST)', () => {
    expect(getTimezoneAbbreviation('Asia/Tokyo', new Date('2023-01-15'))).toBe('JST')
    expect(getTimezoneAbbreviation('Asia/Tokyo', new Date('2023-07-15'))).toBe('JST')
  })

  it('returns the timezone string for unknown timezones', () => {
    expect(getTimezoneAbbreviation('Unknown/Zone')).toBe('Unknown/Zone')
  })

  it('returns PST or PDT for Los Angeles', () => {
    const result = getTimezoneAbbreviation('America/Los_Angeles', new Date('2023-01-15'))
    expect(['PST', 'PDT']).toContain(result)
  })
})

describe('formatDateTime', () => {
  it('formats a date with time', () => {
    const date = new Date('2023-05-15T14:30:00')
    const result = formatDateTime(date)
    expect(result).toMatch(/May 15, 2023/)
  })

  it('appends timezone abbreviation when timezone is provided', () => {
    const date = new Date('2023-05-15T14:30:00Z')
    const result = formatDateTime(date, 'UTC')
    expect(result).toContain('UTC')
  })
})

describe('formatDate', () => {
  it('formats a date without time', () => {
    const date = new Date('2023-05-15T14:30:00')
    const result = formatDate(date)
    expect(result).toMatch(/May 15, 2023/)
    expect(result).not.toMatch(/14:30/)
  })
})

describe('formatAbsoluteDate', () => {
  it('formats an ISO date string', () => {
    const result = formatAbsoluteDate('2023-05-15T14:30:00Z')
    expect(result).toMatch(/May/)
    expect(result).toMatch(/2023/)
  })
})

describe('formatTime', () => {
  it('formats time only', () => {
    const date = new Date('2023-05-15T14:30:00')
    const result = formatTime(date)
    expect(result).toMatch(/2:30 PM|14:30/)
  })
})

describe('formatTimeWithSeconds', () => {
  it('formats time with seconds and timezone', () => {
    const date = new Date('2023-05-15T14:30:45')
    const result = formatTimeWithSeconds(date)
    expect(result).toMatch(/2:30:45 PM|14:30:45/)
  })

  it('omits timezone when includeTimezone is false', () => {
    const date = new Date('2023-05-15T14:30:45')
    const withTz = formatTimeWithSeconds(date, true)
    const withoutTz = formatTimeWithSeconds(date, false)
    expect(withoutTz.length).toBeLessThanOrEqual(withTz.length)
  })
})

describe('formatCompactTimestamp', () => {
  it('produces MM-DD HH:mm pattern', () => {
    const result = formatCompactTimestamp('2023-05-15T14:30:00')
    expect(result).toMatch(/^\d{2}-\d{2} \d{2}:\d{2}$/)
  })

  it('returns a formatted string even for invalid dates (no throw)', () => {
    const result = formatCompactTimestamp('not-a-date')
    expect(typeof result).toBe('string')
  })
})

describe('formatDuration', () => {
  it('returns "0ms" for 0', () => {
    expect(formatDuration(0)).toBe('0ms')
  })

  it('formats milliseconds', () => {
    expect(formatDuration(500)).toBe('500ms')
  })

  it('formats seconds', () => {
    expect(formatDuration(5000)).toBe('5s')
  })

  it('formats minutes and seconds', () => {
    expect(formatDuration(65000)).toBe('1m 5s')
  })

  it('formats hours and minutes', () => {
    expect(formatDuration(3725000)).toBe('1h 2m')
  })

  it('returns null for null', () => {
    expect(formatDuration(null)).toBeNull()
  })

  it('returns null for undefined', () => {
    expect(formatDuration(undefined)).toBeNull()
  })

  it('parses string durations', () => {
    expect(formatDuration('500ms')).toBe('500ms')
  })

  it('returns em dash for NaN', () => {
    expect(formatDuration(Number.NaN)).toBe('\u2014')
  })

  it('returns em dash for Infinity', () => {
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('\u2014')
  })

  it('supports precision option for seconds', () => {
    expect(formatDuration(1500, { precision: 1 })).toBe('1.5s')
    expect(formatDuration(5000, { precision: 1 })).toBe('5s')
  })

  it('formats sub-millisecond durations', () => {
    expect(formatDuration(0.5)).toBe('0.50ms')
    expect(formatDuration(0.001)).toBe('0ms')
  })

  it('returns original string for non-numeric strings', () => {
    expect(formatDuration('not-a-number')).toBe('not-a-number')
  })
})

describe('formatRelativeTime', () => {
  it('returns "just now" for recent dates', () => {
    const now = new Date()
    expect(formatRelativeTime(now.toISOString())).toBe('just now')
  })

  it('returns minutes ago', () => {
    const date = new Date(Date.now() - 5 * 60 * 1000)
    expect(formatRelativeTime(date.toISOString())).toBe('5m ago')
  })

  it('returns hours ago', () => {
    const date = new Date(Date.now() - 3 * 60 * 60 * 1000)
    expect(formatRelativeTime(date.toISOString())).toBe('3h ago')
  })

  it('returns days ago', () => {
    const date = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
    expect(formatRelativeTime(date.toISOString())).toBe('2d ago')
  })
})
