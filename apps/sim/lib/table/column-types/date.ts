import { Calendar as CalendarIcon } from '@sim/emcn/icons'
import type { ColumnTypeDefinition } from '@/lib/table/column-types/types'
import {
  formatDateCellDisplay,
  normalizeDateCellValue,
  storedDateToEditable,
} from '@/lib/table/dates'
import type { JsonValue } from '@/lib/table/types'

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
    // Date instances and epoch numbers may still be out of the representable
    // range (>±8.64e15ms) — guard `toISOString()`, which throws RangeError on
    // an Invalid Date, so an over-range value degrades to `{ ok: false }`
    // rather than crashing the write.
    const date = value instanceof Date ? value : typeof value === 'number' ? new Date(value) : null
    if (date && !Number.isNaN(date.getTime())) return { ok: true, value: date.toISOString() }
    return { ok: false }
  },

  isCompatibleWith(value) {
    // Stricter than `coerce` on purpose. Writing a number into a date cell is a
    // deliberate act — the caller means epoch milliseconds. Reinterpreting a
    // whole NUMBER column as epochs is not: a column of 1, 5, 42 would become
    // three timestamps in January 1970, irreversibly, and a Unix-seconds column
    // would land in 1970 rather than the year it means. Refuse the bulk
    // conversion; single writes still accept epochs.
    if (typeof value === 'number') return false
    return dateColumnType.coerce(value as JsonValue, { name: '', type: 'date' }).ok
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
