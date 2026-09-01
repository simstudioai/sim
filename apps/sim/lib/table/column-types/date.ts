import { Calendar as CalendarIcon } from '@sim/emcn/icons'
import type { ColumnTypeDefinition } from '@/lib/table/column-types/types'
import {
  formatDateCellDisplay,
  normalizeDateCellValue,
  storedDateToEditable,
} from '@/lib/table/dates'

export const dateColumnType: ColumnTypeDefinition = {
  id: 'date',
  label: 'Date',
  icon: CalendarIcon,
  jsonbCast: 'timestamptz',
  storesOpaqueIds: false,
  supportsUnique: true,
  sampleValue: '2024-01-31',
  ownedMetadata: [],
  workflowInputType: 'string',
  editor: 'date',
  expandable: false,
  typeaheadPattern: /[\d\-/]/,
  parseErrorMessage: 'Invalid date',

  coerce(value) {
    if (typeof value === 'string') {
      const normalized = normalizeDateCellValue(value)
      return normalized === null ? { ok: false } : { ok: true, value: normalized }
    }
    // A bare number is refused wherever there is a caller to tell. It is the
    // one input whose meaning cannot be recovered from the value itself: `1600000000` is
    // September 2020 read as Unix seconds and 19 January 1970 read as
    // milliseconds, both readings are in range, and nothing on the wire says
    // which was meant — picking either silently stores a timestamp 50 years off
    // under a 200. An ISO-8601 string carries its own unit; that is what a date
    // cell takes. `salvage` keeps the milliseconds reading for the machine
    // paths, where the only other answer is a blank cell.
    //
    // A Date instance may still be out of the representable range (>±8.64e15ms),
    // so `toISOString()` is guarded — it throws RangeError on an Invalid Date —
    // and an over-range value degrades to `{ ok: false }` rather than crashing
    // the write.
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return { ok: true, value: value.toISOString() }
    }
    return { ok: false }
  },

  salvage(value) {
    // Milliseconds — the reading every caller got before — restored only where
    // refusing would blank the cell rather than answer anyone. A machine
    // emitting an epoch for a date column is overwhelmingly producing
    // `Date.now()` or another JS timestamp, both milliseconds; guessing wrong
    // there costs a wrong year, guessing not at all costs the value.
    if (typeof value !== 'number') return { ok: false }
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? { ok: false } : { ok: true, value: date.toISOString() }
  },

  validateCell(value, column) {
    const valid =
      value instanceof Date || (typeof value === 'string' && !Number.isNaN(Date.parse(value)))
    return valid ? null : `${column.name} must be valid date`
  },

  formatForDisplay(value) {
    return formatDateCellDisplay(String(value), { seconds: true })
  },

  formatForInput(value) {
    return storedDateToEditable(String(value))
  },
}
