import { Calendar as CalendarIcon } from '@sim/emcn/icons'
import type { ColumnTypeDefinition } from '@/lib/table/column-types/types'
import { ownedKeysOf } from '@/lib/table/column-types/types'
import {
  formatDateCellDisplay,
  normalizeDateCellValue,
  storedDateToEditable,
} from '@/lib/table/dates'
import type { ColumnDefinition, JsonValue } from '@/lib/table/types'

/** A leading `YYYY-MM-DD`, the calendar-day prefix of the canonical forms. */
const CALENDAR_DAY_PREFIX = /^\d{4}-\d{2}-\d{2}/

/**
 * Drops the time of day from a normalized value when the column is date-only.
 *
 * `normalizeDateCellValue` already returns a bare `YYYY-MM-DD` for input that
 * carried no time, so this only bites when a time arrives anyway — a paste, a
 * CSV cell, a tool write. Without it a "Due date" column silently accumulates
 * instants, and two rows entered the same day stop comparing equal.
 *
 * Matched rather than sliced. A fixed `slice(0, 10)` assumes a four-digit year,
 * which is not guaranteed: `normalizeDateCellValue` does not pad the year, and
 * `toISOString` emits `±YYYYYY` outside 1000–9999. `0001-01-01T00:00:00Z` —
 * .NET's `DateTime.MinValue`, common in exported CSVs — normalizes to
 * `1-01-01T00:00:00Z`, and slicing ten characters yields `1-01-01T00`, which
 * `validateCell` then rejects as an invalid date. A value with no calendar-day
 * prefix is returned untouched so it fails validation as itself rather than as
 * a mangled fragment.
 *
 * Truncating textually (not via `Date`) is deliberate: re-parsing would
 * reintroduce exactly the timezone conversion this storage shape avoids.
 */
function applyIncludeTime(normalized: string, column: ColumnDefinition): string {
  // Only an EXPLICIT `false` truncates. An absent flag means a column created
  // before this key existed, and those columns hold instants — defaulting them
  // to date-only would silently truncate a stored time on the next write to any
  // cell. New columns get `includeTime: false` stamped at creation instead, so
  // the good default applies going forward without rewriting history.
  if (column.includeTime !== false) return normalized
  return CALENDAR_DAY_PREFIX.exec(normalized)?.[0] ?? normalized
}

export const dateColumnType: ColumnTypeDefinition = {
  id: 'date',
  label: 'Date',
  icon: CalendarIcon,
  jsonbCast: 'timestamptz',
  orderable: true,
  storesOpaqueIds: false,
  supportsUnique: true,
  sampleValue: '2024-01-31',
  ownedMetadata: ownedKeysOf('date'),
  workflowInputType: 'string',
  editor: 'date',
  expandable: false,
  typeaheadPattern: /[\d\-/]/,
  parseErrorMessage: 'Invalid date',

  coerce(value, column) {
    if (typeof value === 'string') {
      const normalized = normalizeDateCellValue(value)
      if (normalized === null) return { ok: false }
      return { ok: true, value: applyIncludeTime(normalized, column) }
    }
    // Date instances and epoch numbers may still be out of the representable
    // range (>±8.64e15ms) — guard `toISOString()`, which throws RangeError on
    // an Invalid Date, so an over-range value degrades to `{ ok: false }`
    // rather than crashing the write.
    const date = value instanceof Date ? value : typeof value === 'number' ? new Date(value) : null
    if (date && !Number.isNaN(date.getTime())) {
      return { ok: true, value: applyIncludeTime(date.toISOString(), column) }
    }
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

  display(value) {
    if (value === null || value === undefined) return { kind: 'empty' }
    return { kind: 'date', text: String(value) }
  },

  formatForDisplay(value) {
    return formatDateCellDisplay(String(value), { seconds: true })
  },

  formatForInput(value) {
    return storedDateToEditable(String(value))
  },

  // Stamped only on creation, so a NEW date column is date-only by default —
  // the right shape for the due dates and birthdays most date columns hold —
  // while a column that predates the key keeps its instants (see
  // `applyIncludeTime`).
  describe(column) {
    return column.includeTime === false ? 'Date' : 'Date and time'
  },

  defaultMetadata(column) {
    return { includeTime: column.includeTime ?? false }
  },
}
