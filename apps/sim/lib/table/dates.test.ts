/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  formatDateCellDisplay,
  isCalendarDateString,
  normalizeDateCellValue,
  storedDateToEditable,
} from '@/lib/table/dates'

/** The runtime zone's offset suffix at a given local wall time, e.g. `-07:00`. */
function localOffsetSuffix(local: Date): string {
  const minutes = -local.getTimezoneOffset()
  if (minutes === 0) return 'Z'
  const sign = minutes > 0 ? '+' : '-'
  const abs = Math.abs(minutes)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
}

describe('isCalendarDateString', () => {
  it('accepts YYYY-MM-DD and rejects everything else', () => {
    expect(isCalendarDateString('2026-07-06')).toBe(true)
    expect(isCalendarDateString('2024-02-29')).toBe(true)
    expect(isCalendarDateString('2026-02-30')).toBe(false)
    expect(isCalendarDateString('2026-13-45')).toBe(false)
    expect(isCalendarDateString('2026-07-06T00:00:00Z')).toBe(false)
    expect(isCalendarDateString('07/06/2026')).toBe(false)
  })
})

describe('normalizeDateCellValue', () => {
  it('keeps calendar dates timezone-free', () => {
    expect(normalizeDateCellValue('2026-07-06')).toBe('2026-07-06')
    expect(normalizeDateCellValue(' 2026-07-06 ')).toBe('2026-07-06')
  })

  it('normalizes date-only inputs in other formats to calendar dates', () => {
    expect(normalizeDateCellValue('07/06/2026')).toBe('2026-07-06')
    expect(normalizeDateCellValue('7/6/2026')).toBe('2026-07-06')
    expect(normalizeDateCellValue('July 6, 2026')).toBe('2026-07-06')
  })

  it('normalizes reduced-precision ISO forms via their UTC day', () => {
    expect(normalizeDateCellValue('2026-07')).toBe('2026-07-01')
    expect(normalizeDateCellValue('2026')).toBe('2026-01-01')
  })

  it('preserves the wall time and offset of explicit-offset inputs', () => {
    expect(normalizeDateCellValue('2026-07-06T16:04:55-07:00')).toBe('2026-07-06T16:04:55-07:00')
    expect(normalizeDateCellValue('2026-07-06 16:04:55 PDT')).toBe('2026-07-06T16:04:55-07:00')
    expect(normalizeDateCellValue('2026-07-06T23:04:55.000Z')).toBe('2026-07-06T23:04:55Z')
    expect(normalizeDateCellValue('2026-07-06 16:04:55+00')).toBe('2026-07-06T16:04:55Z')
    expect(normalizeDateCellValue('2026-07-06 16:04:55 EST')).toBe('2026-07-06T16:04:55-05:00')
  })

  it('is idempotent on canonical instants', () => {
    const canonical = '2026-07-06T16:04:55-07:00'
    expect(normalizeDateCellValue(canonical)).toBe(canonical)
    expect(normalizeDateCellValue(canonical, { timezone: 'Asia/Tokyo' })).toBe(canonical)
  })

  it('stamps naive datetimes with the runtime zone offset by default', () => {
    const local = new Date(2026, 6, 6, 16, 4, 55)
    expect(normalizeDateCellValue('2026-07-06 16:04:55')).toBe(
      `2026-07-06T16:04:55${localOffsetSuffix(local)}`
    )
  })

  it('stamps naive datetimes with the provided IANA zone offset', () => {
    // July → America/New_York is EDT (UTC-4)
    expect(normalizeDateCellValue('2026-07-06 16:04:55', { timezone: 'America/New_York' })).toBe(
      '2026-07-06T16:04:55-04:00'
    )
    // January → EST (UTC-5); DST resolved per wall date, not per import date
    expect(normalizeDateCellValue('2026-01-15 12:00', { timezone: 'America/New_York' })).toBe(
      '2026-01-15T12:00:00-05:00'
    )
    expect(normalizeDateCellValue('7/6/2026 4:04 PM', { timezone: 'America/Los_Angeles' })).toBe(
      '2026-07-06T16:04:00-07:00'
    )
  })

  it('reads localized numeric wall clocks before applying the provided IANA zone', () => {
    expect(normalizeDateCellValue('3/8/2026 2:30 AM', { timezone: 'America/New_York' })).toBe(
      '2026-03-08T02:30:00-05:00'
    )
    expect(normalizeDateCellValue('7/6/2026, 16:04:55', { timezone: 'Asia/Tokyo' })).toBe(
      '2026-07-06T16:04:55+09:00'
    )
  })

  it('reads month-name wall clocks independently of the runtime timezone', () => {
    expect(normalizeDateCellValue('March 8, 2026 2:30 AM', { timezone: 'America/New_York' })).toBe(
      '2026-03-08T02:30:00-05:00'
    )
  })

  it.each([
    ['America/New_York', '2026-11-01 01:30:00', '2026-11-01T01:30:00-04:00'],
    ['America/New_York', '2026-03-08 02:30:00', '2026-03-08T02:30:00-05:00'],
    ['Asia/Kathmandu', '2026-06-15 09:00:00', '2026-06-15T09:00:00+05:45'],
    ['Australia/Lord_Howe', '2026-06-15 09:00:00', '2026-06-15T09:00:00+10:30'],
  ])('uses the shared timezone rules for %s', (timezone, input, expected) => {
    expect(normalizeDateCellValue(input, { timezone })).toBe(expected)
  })

  it('ignores the zone option when the input carries an explicit offset', () => {
    expect(
      normalizeDateCellValue('2026-07-06T23:04:55.000Z', { timezone: 'America/New_York' })
    ).toBe('2026-07-06T23:04:55Z')
    expect(
      normalizeDateCellValue('2026-07-06 16:04:55 PDT', { timezone: 'America/New_York' })
    ).toBe('2026-07-06T16:04:55-07:00')
  })

  it('leaves calendar dates untouched by the zone option', () => {
    expect(normalizeDateCellValue('2026-07-06', { timezone: 'America/New_York' })).toBe(
      '2026-07-06'
    )
  })

  it('throws on an invalid IANA zone', () => {
    expect(() => normalizeDateCellValue('2026-07-06 12:00', { timezone: 'Not/AZone' })).toThrow(
      RangeError
    )
  })

  it('returns null for unparseable input', () => {
    expect(normalizeDateCellValue('not-a-date')).toBeNull()
    expect(normalizeDateCellValue('')).toBeNull()
    expect(normalizeDateCellValue('2026-13-45')).toBeNull()
    expect(normalizeDateCellValue('13/06/2026')).toBeNull()
  })

  it('rejects impossible ISO calendar and time fields', () => {
    expect(normalizeDateCellValue('2026-02-30')).toBeNull()
    expect(normalizeDateCellValue('2025-02-29T12:00:00Z')).toBeNull()
    expect(normalizeDateCellValue('2026-02-30 12:00', { timezone: 'UTC' })).toBeNull()
    expect(normalizeDateCellValue('2026-02-30 12:00 PDT')).toBeNull()
    expect(normalizeDateCellValue('2026-07-06T24:00', { timezone: 'UTC' })).toBeNull()
    expect(normalizeDateCellValue('2026-07-06 24:00+00')).toBeNull()
    expect(normalizeDateCellValue('2026-07-06T12:60:00-04:00')).toBeNull()
  })

  it('accepts leap days and valid daylight-saving gap wall clocks', () => {
    expect(normalizeDateCellValue('2024-02-29')).toBe('2024-02-29')
    expect(normalizeDateCellValue('2024-02-29T12:00:00Z')).toBe('2024-02-29T12:00:00Z')
    expect(normalizeDateCellValue('2026-03-08T02:30:00', { timezone: 'America/New_York' })).toBe(
      '2026-03-08T02:30:00-05:00'
    )
  })
})

describe('formatDateCellDisplay', () => {
  it('renders calendar dates as MM/DD/YYYY', () => {
    expect(formatDateCellDisplay('2026-07-06')).toBe('07/06/2026')
  })

  it('renders legacy UTC-midnight instants as their UTC calendar day', () => {
    expect(formatDateCellDisplay('2026-07-06T00:00:00.000Z')).toBe('07/06/2026')
    expect(formatDateCellDisplay('2026-07-06T00:00:00Z')).toBe('07/06/2026')
  })

  it('renders the literal wall time — identical for every viewer', () => {
    expect(formatDateCellDisplay('2026-07-06T16:04:55-07:00')).toBe('07/06/2026 4:04 PM')
    expect(formatDateCellDisplay('2026-07-06T16:04:55-07:00', { seconds: true })).toBe(
      '07/06/2026 4:04:55 PM'
    )
    // The offset never shifts the displayed wall time
    expect(formatDateCellDisplay('2026-07-06T16:04:55+09:00')).toBe('07/06/2026 4:04 PM')
    expect(formatDateCellDisplay('2026-07-06T23:04:55Z')).toBe('07/06/2026 11:04 PM')
    expect(formatDateCellDisplay('2026-07-06T00:30:00-07:00')).toBe('07/06/2026 12:30 AM')
  })

  it('omits the seconds suffix when seconds are zero', () => {
    expect(formatDateCellDisplay('2026-07-06T23:04:00Z', { seconds: true })).toBe(
      '07/06/2026 11:04 PM'
    )
  })

  it('returns unparseable legacy strings as-is', () => {
    expect(formatDateCellDisplay('garbage')).toBe('garbage')
  })
})

describe('storedDateToEditable', () => {
  it('surfaces legacy UTC-midnight instants as their UTC calendar day', () => {
    expect(storedDateToEditable('2026-07-06T00:00:00.000Z')).toBe('2026-07-06')
  })

  it('keeps calendar dates and canonicalizes instants', () => {
    expect(storedDateToEditable('2026-07-06')).toBe('2026-07-06')
    expect(storedDateToEditable('2026-07-06T16:04:55-07:00')).toBe('2026-07-06T16:04:55-07:00')
    expect(storedDateToEditable('2026-07-06T23:04:55.000Z')).toBe('2026-07-06T23:04:55Z')
  })

  it('passes unparseable legacy strings through', () => {
    expect(storedDateToEditable('garbage')).toBe('garbage')
  })
})
