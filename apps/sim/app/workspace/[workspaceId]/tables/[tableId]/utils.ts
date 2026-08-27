import { getWallClockParts } from '@/lib/core/utils/timezone'
import type { ColumnDefinition, JsonValue } from '@/lib/table'
import type { ColumnType } from '@/lib/table/column-types'
import { columnTypeById, columnTypeOf } from '@/lib/table/column-types'
import { formatDateCellDisplay, normalizeDateCellValue } from '@/lib/table/dates'

/**
 * Pick a fresh "untitled[_N]" name not already taken by `columns`. Used by
 * both the page-header and inline-header "New column" dropdowns.
 */
export function generateColumnName(columns: ReadonlyArray<{ name: string }>): string {
  const existing = new Set(columns.map((c) => c.name.toLowerCase()))
  let name = 'untitled'
  let i = 2
  while (existing.has(name.toLowerCase())) {
    name = `untitled_${i}`
    i++
  }
  return name
}

/**
 * Coerce a value a person typed or pasted into a cell to that column's type.
 * Throws on invalid JSON, and answers `null` for everything else the column
 * type can read nothing from.
 *
 * The result is what the server would store for the same value, which is the
 * point: the optimistic cache and the row that comes back agree. The grid
 * writes through a first-party route, which runs the `null` policy — so a
 * refused value falls back to `ColumnTypeDefinition.salvage` here exactly as it
 * does there, and a multiselect paste naming one live option and one deleted
 * one keeps the live one instead of erasing the cell.
 */
export function cleanCellValue(
  value: unknown,
  column: ColumnDefinition,
  timeZone?: string
): unknown {
  // These three read the browser's own context (the viewer's timezone, a JSON
  // draft that must throw so the editor can show a parse error, a checkbox's
  // truthiness) so they cannot come from the shared coercion.
  if (column.type === 'json') {
    if (typeof value === 'string') {
      if (value === '') return null
      return JSON.parse(value)
    }
    return value
  }
  if (column.type === 'boolean') return Boolean(value)
  if (column.type === 'date') {
    if (value === '' || value === null || value === undefined) return null
    return displayToStorage(String(value), timeZone)
  }
  if (value === '' || value === null || value === undefined) return null

  // Everything else runs the SAME coercion the server will run, so the
  // optimistic cache holds exactly the value that gets persisted.
  const columnType = columnTypeOf(column)
  const coerced = columnType.coerce(value as JsonValue, column, { timezone: timeZone })
  if (coerced.ok) return coerced.value
  const salvaged = columnType.salvage?.(value as JsonValue, column)
  return salvaged?.ok ? salvaged.value : null
}

/**
 * Format a stored value for display in an input field. Defensive against
 * shape drift: a column whose declared type lags its actual data (e.g. a
 * workflow column mid-remap, where the schema cache hasn't refetched but
 * row data already has the new mapping's value) would otherwise render
 * `[object Object]` via `String(value)`.
 */
export function formatValueForInput(value: unknown, type: string, timeZone?: string): string {
  if (value === null || value === undefined) return ''
  const definition = columnTypeById(type)
  // Shape-drift guard, kept ahead of the registry: a column whose declared type
  // lags its actual data (a workflow column mid-remap, where the schema cache
  // hasn't refetched but row data already holds the new mapping's value) would
  // otherwise render `[object Object]` through a scalar type's formatter.
  if (typeof value === 'object' && !definition.storesOpaqueIds && type !== 'json') {
    return JSON.stringify(value)
  }
  return definition.formatForInput(
    value,
    { name: '', type: type as ColumnType },
    { timezone: timeZone }
  )
}

/** A canonical date-cell value split into its wall-clock editing parts. */
export interface DateCellLocalParts {
  /** Calendar day `YYYY-MM-DD`, or null when the value is unparseable. */
  day: string | null
  /** Time-of-day `HH:mm:ss`, or null for calendar-date values. */
  time: string | null
}

/**
 * Splits a canonical date-cell value into the day and time the date/time
 * pickers edit — the value's **literal wall time**, no timezone conversion
 * (display and editing are wall-clock-faithful for every viewer). Calendar
 * dates have no time part; legacy strings normalize first.
 */
export function dateValueToLocalParts(value: string): DateCellLocalParts {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return { day: value, time: null }
  const wall = value.match(
    /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::(\d{2}))?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/
  )
  if (wall) return { day: wall[1], time: `${wall[2]}:${wall[3] ?? '00'}` }
  const canonical = normalizeDateCellValue(value)
  if (!canonical || canonical === value) return { day: null, time: null }
  return dateValueToLocalParts(canonical)
}

/**
 * Recombines picker-edited parts into a canonical date-cell value: a calendar
 * date when there is no time, else that wall time stamped with the given
 * zone's offset (runtime-local when omitted).
 */
export function localPartsToDateValue(day: string, time: string | null, timeZone?: string): string {
  if (!time) return day
  return normalizeDateCellValue(`${day}T${time}`, { timezone: timeZone }) ?? day
}

/** Today's calendar day as `YYYY-MM-DD` in the given zone (runtime-local when omitted). */
export function todayLocalCalendarDate(timeZone?: string): string {
  const wall = getWallClockParts(new Date(), timeZone)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${wall.year}-${pad(wall.month)}-${pad(wall.day)}`
}

/**
 * Format a stored date-cell value for display: calendar dates as MM/DD/YYYY,
 * instants as their literal wall time `MM/DD/YYYY h:mm AM/PM` — identical
 * for every viewer. Pass `seconds: true` for editor drafts so re-saving an
 * untouched cell keeps second precision.
 */
export function storageToDisplay(stored: string, options?: { seconds?: boolean }): string {
  return formatDateCellDisplay(stored, options)
}

/**
 * Parse a date-cell input string to its canonical storage form: `YYYY-MM-DD`
 * for date-only inputs (MM/DD/YYYY, MM/DD, ISO), an offset-preserved instant
 * for inputs carrying a time. Naive times are stamped with the offset of
 * `timeZone` (the writer's effective timezone; the runtime's zone when
 * omitted). Returns null when unparseable.
 */
export function displayToStorage(display: string, timeZone?: string): string | null {
  const trimmed = display.trim()
  const partial = trimmed.match(/^(\d{1,2})\/(\d{1,2})$/)
  if (partial) {
    const year = Number(todayLocalCalendarDate(timeZone).slice(0, 4))
    return normalizeDateCellValue(
      `${year}-${partial[1].padStart(2, '0')}-${partial[2].padStart(2, '0')}`
    )
  }
  return normalizeDateCellValue(trimmed, { timezone: timeZone })
}
