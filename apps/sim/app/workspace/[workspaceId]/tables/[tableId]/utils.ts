import type { ColumnDefinition } from '@/lib/table'
import {
  formatDateCellDisplay,
  getWallClockParts,
  normalizeDateCellValue,
  storedDateToEditable,
} from '@/lib/table/dates'

type BadgeVariant = 'green' | 'blue' | 'purple' | 'orange' | 'teal' | 'gray'

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
 * Returns the appropriate badge color variant for a column type
 */
export function getTypeBadgeVariant(type: string): BadgeVariant {
  switch (type) {
    case 'string':
      return 'green'
    case 'number':
      return 'blue'
    case 'boolean':
      return 'purple'
    case 'json':
      return 'orange'
    case 'date':
      return 'teal'
    default:
      return 'gray'
  }
}

/**
 * Coerce a raw input value to the appropriate type for a column.
 * Throws on invalid JSON.
 */
export function cleanCellValue(
  value: unknown,
  column: ColumnDefinition,
  timeZone?: string
): unknown {
  if (column.type === 'number') {
    if (value === '') return null
    const num = Number(value)
    return Number.isNaN(num) ? null : num
  }
  if (column.type === 'json') {
    if (typeof value === 'string') {
      if (value === '') return null
      return JSON.parse(value)
    }
    return value
  }
  if (column.type === 'boolean') {
    return Boolean(value)
  }
  if (column.type === 'date') {
    if (value === '' || value === null || value === undefined) return null
    return displayToStorage(String(value), timeZone)
  }
  return value || null
}

/**
 * Format a stored value for display in an input field. Defensive against
 * shape drift: a column whose declared type lags its actual data (e.g. a
 * workflow column mid-remap, where the schema cache hasn't refetched but
 * row data already has the new mapping's value) would otherwise render
 * `[object Object]` via `String(value)`.
 */
export function formatValueForInput(value: unknown, type: string): string {
  if (value === null || value === undefined) return ''
  if (type === 'json') {
    return typeof value === 'string' ? value : JSON.stringify(value)
  }
  if (type === 'date' && value) {
    return storedDateToEditable(String(value))
  }
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
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
  const withTime = trimmed.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(AM|PM))?$/i
  )
  if (withTime) {
    const [, m, d, y, h, min, sec, meridiem] = withTime
    let hours = Number(h)
    if (meridiem) {
      if (hours < 1 || hours > 12) return null
      hours = (hours % 12) + (meridiem.toUpperCase() === 'PM' ? 12 : 0)
    } else if (hours > 23) {
      return null
    }
    if (Number(min) > 59 || Number(sec ?? 0) > 59) return null
    // Date.parse rolls impossible days over (02/30 → 03/02) instead of
    // rejecting them, so validate the calendar day explicitly.
    const dayCheck = new Date(Number(y), Number(m) - 1, Number(d))
    if (dayCheck.getMonth() !== Number(m) - 1 || dayCheck.getDate() !== Number(d)) return null
    const pad = (n: string) => n.padStart(2, '0')
    // Route through the shared normalizer so the wall time resolves in the
    // effective zone.
    return normalizeDateCellValue(
      `${y}-${pad(m)}-${pad(d)}T${String(hours).padStart(2, '0')}:${min}:${sec ?? '00'}`,
      { timezone: timeZone }
    )
  }
  const full = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (full) {
    const month = Number(full[1])
    const day = Number(full[2])
    if (month < 1 || month > 12 || day < 1 || day > 31) return null
    return `${full[3]}-${full[1].padStart(2, '0')}-${full[2].padStart(2, '0')}`
  }
  const partial = trimmed.match(/^(\d{1,2})\/(\d{1,2})$/)
  if (partial) {
    const month = Number(partial[1])
    const day = Number(partial[2])
    if (month < 1 || month > 12 || day < 1 || day > 31) return null
    const year = todayLocalCalendarDate(timeZone).slice(0, 4)
    return `${year}-${partial[1].padStart(2, '0')}-${partial[2].padStart(2, '0')}`
  }
  return normalizeDateCellValue(trimmed, { timezone: timeZone })
}
