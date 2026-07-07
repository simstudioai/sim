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

describe('isCalendarDateString', () => {
  it('accepts YYYY-MM-DD and rejects everything else', () => {
    expect(isCalendarDateString('2026-07-06')).toBe(true)
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

  it('converts inputs with an explicit offset to exact UTC instants', () => {
    expect(normalizeDateCellValue('2026-07-06T16:04:55-07:00')).toBe('2026-07-06T23:04:55.000Z')
    expect(normalizeDateCellValue('2026-07-06 16:04:55 PDT')).toBe('2026-07-06T23:04:55.000Z')
    expect(normalizeDateCellValue('2026-07-06T23:04:55.000Z')).toBe('2026-07-06T23:04:55.000Z')
    expect(normalizeDateCellValue('2026-07-06 16:04:55+00')).toBe('2026-07-06T16:04:55.000Z')
  })

  it('interprets naive datetimes in the runtime local zone by default', () => {
    expect(normalizeDateCellValue('2026-07-06 16:04:55')).toBe(
      new Date(2026, 6, 6, 16, 4, 55).toISOString()
    )
  })

  it('interprets naive datetimes in the provided IANA zone', () => {
    // July → America/New_York is EDT (UTC-4)
    expect(normalizeDateCellValue('2026-07-06 16:04:55', { timezone: 'America/New_York' })).toBe(
      '2026-07-06T20:04:55.000Z'
    )
    // January → EST (UTC-5); DST resolved per wall date, not per import date
    expect(normalizeDateCellValue('2026-01-15 12:00', { timezone: 'America/New_York' })).toBe(
      '2026-01-15T17:00:00.000Z'
    )
    expect(normalizeDateCellValue('7/6/2026 4:04 PM', { timezone: 'America/Los_Angeles' })).toBe(
      '2026-07-06T23:04:00.000Z'
    )
  })

  it('ignores the zone option when the input carries an explicit offset', () => {
    expect(
      normalizeDateCellValue('2026-07-06T23:04:55.000Z', { timezone: 'America/New_York' })
    ).toBe('2026-07-06T23:04:55.000Z')
    expect(
      normalizeDateCellValue('2026-07-06 16:04:55 PDT', { timezone: 'America/New_York' })
    ).toBe('2026-07-06T23:04:55.000Z')
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
})

describe('formatDateCellDisplay', () => {
  it('renders calendar dates as MM/DD/YYYY', () => {
    expect(formatDateCellDisplay('2026-07-06')).toBe('07/06/2026')
  })

  it('renders legacy UTC-midnight instants as their UTC calendar day', () => {
    expect(formatDateCellDisplay('2026-07-06T00:00:00.000Z')).toBe('07/06/2026')
    expect(formatDateCellDisplay('2026-07-06T00:00:00Z')).toBe('07/06/2026')
  })

  it('renders instants in the viewer local zone with a 12-hour time', () => {
    const stored = '2026-07-06T23:04:55.000Z'
    const local = new Date(stored)
    const hours24 = local.getHours()
    const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12
    const expectedDay = `${String(local.getMonth() + 1).padStart(2, '0')}/${String(
      local.getDate()
    ).padStart(2, '0')}/${local.getFullYear()}`
    const meridiem = hours24 < 12 ? 'AM' : 'PM'
    expect(formatDateCellDisplay(stored)).toBe(`${expectedDay} ${hours12}:04 ${meridiem}`)
    expect(formatDateCellDisplay(stored, { seconds: true })).toBe(
      `${expectedDay} ${hours12}:04:55 ${meridiem}`
    )
  })

  it('omits the seconds suffix when seconds are zero', () => {
    const stored = '2026-07-06T23:04:00.000Z'
    expect(formatDateCellDisplay(stored, { seconds: true })).not.toContain(':04:')
  })

  it('returns unparseable legacy strings as-is', () => {
    expect(formatDateCellDisplay('garbage')).toBe('garbage')
  })

  it('renders instants in an explicit IANA zone', () => {
    const stored = '2026-07-06T23:04:55.000Z'
    expect(formatDateCellDisplay(stored, { timeZone: 'America/New_York' })).toBe(
      '07/06/2026 7:04 PM'
    )
    expect(formatDateCellDisplay(stored, { timeZone: 'America/New_York', seconds: true })).toBe(
      '07/06/2026 7:04:55 PM'
    )
    // Day rolls forward east of the instant's UTC day
    expect(formatDateCellDisplay(stored, { timeZone: 'Asia/Tokyo' })).toBe('07/07/2026 8:04 AM')
  })

  it('keeps calendar dates zone-independent', () => {
    expect(formatDateCellDisplay('2026-07-06', { timeZone: 'Asia/Tokyo' })).toBe('07/06/2026')
  })
})

describe('storedDateToEditable', () => {
  it('surfaces legacy UTC-midnight instants as their UTC calendar day', () => {
    expect(storedDateToEditable('2026-07-06T00:00:00.000Z')).toBe('2026-07-06')
  })

  it('keeps calendar dates and real instants canonical', () => {
    expect(storedDateToEditable('2026-07-06')).toBe('2026-07-06')
    expect(storedDateToEditable('2026-07-06T23:04:55.000Z')).toBe('2026-07-06T23:04:55.000Z')
  })

  it('passes unparseable legacy strings through', () => {
    expect(storedDateToEditable('garbage')).toBe('garbage')
  })
})
