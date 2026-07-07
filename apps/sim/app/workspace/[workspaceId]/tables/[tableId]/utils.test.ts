/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  cleanCellValue,
  dateValueToLocalParts,
  displayToStorage,
  formatValueForInput,
  localPartsToDateValue,
  storageToDisplay,
} from '@/app/workspace/[workspaceId]/tables/[tableId]/utils'

describe('dateValueToLocalParts / localPartsToDateValue', () => {
  it('splits calendar dates without a time part and round-trips', () => {
    expect(dateValueToLocalParts('2026-07-06')).toEqual({ day: '2026-07-06', time: null })
    expect(localPartsToDateValue('2026-07-06', null)).toBe('2026-07-06')
  })

  it('splits instants into local day/time and round-trips exactly', () => {
    const stored = new Date(2026, 6, 6, 16, 4, 55).toISOString()
    const parts = dateValueToLocalParts(stored)
    expect(parts).toEqual({ day: '2026-07-06', time: '16:04:55' })
    expect(localPartsToDateValue(parts.day as string, parts.time)).toBe(stored)
  })

  it('keeps the time when only the day changes', () => {
    const stored = new Date(2026, 6, 6, 16, 4, 55).toISOString()
    const parts = dateValueToLocalParts(stored)
    expect(localPartsToDateValue('2026-07-09', parts.time)).toBe(
      new Date(2026, 6, 9, 16, 4, 55).toISOString()
    )
  })

  it('accepts HH:mm times, defaulting seconds to zero', () => {
    expect(localPartsToDateValue('2026-07-06', '16:04')).toBe(
      new Date(2026, 6, 6, 16, 4, 0).toISOString()
    )
  })

  it('returns null parts for unparseable values', () => {
    expect(dateValueToLocalParts('garbage')).toEqual({ day: null, time: null })
    expect(dateValueToLocalParts('')).toEqual({ day: null, time: null })
  })

  it('reads and recombines parts in an explicit IANA zone', () => {
    const stored = '2026-07-06T20:04:55.000Z'
    const parts = dateValueToLocalParts(stored, 'America/New_York')
    expect(parts).toEqual({ day: '2026-07-06', time: '16:04:55' })
    expect(localPartsToDateValue(parts.day as string, parts.time, 'America/New_York')).toBe(stored)
  })
})

describe('timezone-aware display round-trip', () => {
  it('parses and renders wall times in the effective zone, not the runtime zone', () => {
    const zone = 'America/New_York'
    const stored = displayToStorage('07/06/2026 4:04:55 PM', zone)
    expect(stored).toBe('2026-07-06T20:04:55.000Z')
    expect(storageToDisplay(stored as string, { seconds: true, timeZone: zone })).toBe(
      '07/06/2026 4:04:55 PM'
    )
  })
})

describe('displayToStorage', () => {
  it('parses date-only display formats to calendar dates', () => {
    expect(displayToStorage('07/06/2026')).toBe('2026-07-06')
    expect(displayToStorage('7/6/2026')).toBe('2026-07-06')
    expect(displayToStorage('2026-07-06')).toBe('2026-07-06')
    expect(displayToStorage('7/6')).toBe(`${new Date().getFullYear()}-07-06`)
  })

  it('parses M/D/YYYY with a time to a local-zone UTC instant', () => {
    expect(displayToStorage('07/06/2026 4:04 PM')).toBe(
      new Date(2026, 6, 6, 16, 4, 0).toISOString()
    )
    expect(displayToStorage('07/06/2026 4:04:55 PM')).toBe(
      new Date(2026, 6, 6, 16, 4, 55).toISOString()
    )
    expect(displayToStorage('07/06/2026 16:04')).toBe(new Date(2026, 6, 6, 16, 4, 0).toISOString())
    expect(displayToStorage('07/06/2026 12:00 AM')).toBe(
      new Date(2026, 6, 6, 0, 0, 0).toISOString()
    )
  })

  it('passes canonical instants and offset strings through Date.parse exactly', () => {
    expect(displayToStorage('2026-07-06T23:04:55.000Z')).toBe('2026-07-06T23:04:55.000Z')
    expect(displayToStorage('2026-07-06 16:04:55 PDT')).toBe('2026-07-06T23:04:55.000Z')
  })

  it('rejects invalid dates and times', () => {
    expect(displayToStorage('13/06/2026')).toBeNull()
    expect(displayToStorage('07/06/2026 25:00')).toBeNull()
    expect(displayToStorage('07/06/2026 13:00 PM')).toBeNull()
    expect(displayToStorage('02/30/2026 5:00 PM')).toBeNull()
    expect(displayToStorage('garbage')).toBeNull()
  })
})

describe('storageToDisplay', () => {
  it('renders calendar dates as MM/DD/YYYY', () => {
    expect(storageToDisplay('2026-07-06')).toBe('07/06/2026')
  })

  it('round-trips an instant through the editor draft format', () => {
    const stored = new Date(2026, 6, 6, 16, 4, 55).toISOString()
    const draft = storageToDisplay(stored, { seconds: true })
    expect(displayToStorage(draft)).toBe(stored)
  })
})

describe('cleanCellValue', () => {
  it('normalizes date cells to canonical storage', () => {
    const column = { name: 'due', type: 'date' } as const
    expect(cleanCellValue('07/06/2026', column)).toBe('2026-07-06')
    expect(cleanCellValue('2026-07-06T23:04:55.000Z', column)).toBe('2026-07-06T23:04:55.000Z')
    expect(cleanCellValue('nope', column)).toBeNull()
    expect(cleanCellValue('', column)).toBeNull()
  })

  it('leaves non-date types on their existing contracts', () => {
    expect(cleanCellValue('2024', { name: 'n', type: 'number' } as const)).toBe(2024)
    expect(cleanCellValue('true', { name: 'b', type: 'boolean' } as const)).toBe(true)
  })
})

describe('formatValueForInput', () => {
  it('gives editors the canonical value, surfacing legacy UTC midnights as calendar days', () => {
    expect(formatValueForInput('2026-07-06T00:00:00.000Z', 'date')).toBe('2026-07-06')
    expect(formatValueForInput('2026-07-06T23:04:55.000Z', 'date')).toBe('2026-07-06T23:04:55.000Z')
    expect(formatValueForInput('2026-07-06', 'date')).toBe('2026-07-06')
  })
})
