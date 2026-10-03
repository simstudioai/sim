import { describe, expect, it } from 'vitest'
import { columnTypeOf } from '@/lib/table/column-types'
import {
  cleanCellValue,
  dateValueToLocalParts,
  displayToStorage,
  formatValueForInput,
  localPartsToDateValue,
  storageToDisplay,
} from '@/app/workspace/[workspaceId]/tables/[tableId]/utils'

describe('dateValueToLocalParts / localPartsToDateValue', () => {
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
})

describe('displayToStorage', () => {
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

  it('rejects invalid dates and times', () => {
    expect(displayToStorage('13/06/2026')).toBeNull()
    expect(displayToStorage('07/06/2026 25:00')).toBeNull()
    expect(displayToStorage('07/06/2026 13:00 PM')).toBeNull()
    expect(displayToStorage('02/30/2026 5:00 PM')).toBeNull()
    expect(displayToStorage('02/30/2026')).toBeNull()
    expect(displayToStorage('2/30')).toBeNull()
    expect(displayToStorage('garbage')).toBeNull()
  })
})

describe('storageToDisplay', () => {
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
  /**
   * The grid writes through a first-party route, which runs the `null` policy —
   * a member the paste names that resolves to no option is dropped, and the ones
   * that do resolve are kept. Erasing the cell instead would lose two live
   * options over one deleted one. The registry pairing is asserted rather than
   * described so a helper that stops consulting `salvage` fails here.
   */
  it('keeps the members of a partial multiselect paste that still resolve', () => {
    const column = {
      name: 'tags',
      type: 'select',
      multiple: true,
      options: [
        { id: 'opt_a', name: 'Bug' },
        { id: 'opt_b', name: 'Docs' },
      ],
    } as const

    expect(columnTypeOf(column).coerce('Bug, Nope', column)).toEqual({ ok: false })
    expect(columnTypeOf(column).salvage?.('Bug, Nope', column)).toEqual({
      ok: true,
      value: ['opt_a'],
    })
    expect(cleanCellValue('Bug, Nope', column)).toEqual(['opt_a'])
  })
})

describe('formatValueForInput', () => {
  it('preserves TTL strings independently of the viewer timezone', () => {
    const column = { name: 'expires_at', type: 'ttl' } as const
    const input = '2026-06-15T09:00:30Z'
    for (const timezone of ['UTC', 'America/New_York', 'Asia/Kathmandu', 'Mars/Olympus']) {
      expect(formatValueForInput(input, 'ttl')).toBe('2026-06-15T09:00:30-00:00')
      expect(cleanCellValue(input, column, timezone)).toBe('2026-06-15T09:00:30-00:00')
      expect(cleanCellValue('2026-06-15 09:00:30', column, timezone)).toBeNull()
      expect(cleanCellValue(1_700_000_000, column, timezone)).toBeNull()
    }
  })
})
