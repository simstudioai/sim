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

  it('splits instants into their literal wall day/time — no zone conversion', () => {
    expect(dateValueToLocalParts('2026-07-06T16:04:55-07:00')).toEqual({
      day: '2026-07-06',
      time: '16:04:55',
    })
    expect(dateValueToLocalParts('2026-07-06T23:04:55Z')).toEqual({
      day: '2026-07-06',
      time: '23:04:55',
    })
    expect(dateValueToLocalParts('2026-07-06T23:04:55.000Z')).toEqual({
      day: '2026-07-06',
      time: '23:04:55',
    })
  })

  it('recombines parts stamping the given zone offset, keeping the wall time', () => {
    expect(localPartsToDateValue('2026-07-06', '16:04:55', 'America/New_York')).toBe(
      '2026-07-06T16:04:55-04:00'
    )
    expect(localPartsToDateValue('2026-07-09', '16:04:55', 'America/New_York')).toBe(
      '2026-07-09T16:04:55-04:00'
    )
    expect(localPartsToDateValue('2026-07-06', '16:04', 'America/New_York')).toBe(
      '2026-07-06T16:04:00-04:00'
    )
  })

  it('returns null parts for unparseable values', () => {
    expect(dateValueToLocalParts('garbage')).toEqual({ day: null, time: null })
    expect(dateValueToLocalParts('')).toEqual({ day: null, time: null })
  })
})

describe('displayToStorage', () => {
  it('parses date-only display formats to calendar dates', () => {
    expect(displayToStorage('07/06/2026')).toBe('2026-07-06')
    expect(displayToStorage('7/6/2026')).toBe('2026-07-06')
    expect(displayToStorage('2026-07-06')).toBe('2026-07-06')
    expect(displayToStorage('7/6')).toBe(`${new Date().getFullYear()}-07-06`)
  })

  it('parses M/D/YYYY with a time to a wall time stamped with the given zone', () => {
    expect(displayToStorage('07/06/2026 4:04 PM', 'America/New_York')).toBe(
      '2026-07-06T16:04:00-04:00'
    )
    expect(displayToStorage('07/06/2026 4:04:55 PM', 'America/New_York')).toBe(
      '2026-07-06T16:04:55-04:00'
    )
    expect(displayToStorage('07/06/2026 16:04', 'America/New_York')).toBe(
      '2026-07-06T16:04:00-04:00'
    )
    expect(displayToStorage('07/06/2026 12:00 AM', 'America/New_York')).toBe(
      '2026-07-06T00:00:00-04:00'
    )
  })

  it('preserves the wall time and offset of canonical and offset strings', () => {
    expect(displayToStorage('2026-07-06T16:04:55-07:00')).toBe('2026-07-06T16:04:55-07:00')
    expect(displayToStorage('2026-07-06T23:04:55.000Z')).toBe('2026-07-06T23:04:55Z')
    expect(displayToStorage('2026-07-06 16:04:55 PDT')).toBe('2026-07-06T16:04:55-07:00')
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

  it('renders the literal wall time identically regardless of viewer or offset', () => {
    expect(storageToDisplay('2026-07-06T16:04:55-07:00', { seconds: true })).toBe(
      '07/06/2026 4:04:55 PM'
    )
    expect(storageToDisplay('2026-07-06T16:04:55+09:00', { seconds: true })).toBe(
      '07/06/2026 4:04:55 PM'
    )
  })

  it('round-trips an instant through the editor draft format without shifting', () => {
    const stored = displayToStorage('07/06/2026 4:04:55 PM', 'America/New_York') as string
    const draft = storageToDisplay(stored, { seconds: true })
    expect(draft).toBe('07/06/2026 4:04:55 PM')
    expect(displayToStorage(draft, 'America/New_York')).toBe(stored)
  })
})

describe('cleanCellValue', () => {
  it('normalizes date cells to canonical storage', () => {
    const column = { name: 'due', type: 'date' } as const
    expect(cleanCellValue('07/06/2026', column)).toBe('2026-07-06')
    expect(cleanCellValue('2026-07-06T16:04:55-07:00', column)).toBe('2026-07-06T16:04:55-07:00')
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
    expect(formatValueForInput('2026-07-06T16:04:55-07:00', 'date')).toBe(
      '2026-07-06T16:04:55-07:00'
    )
    expect(formatValueForInput('2026-07-06', 'date')).toBe('2026-07-06')
  })
})
