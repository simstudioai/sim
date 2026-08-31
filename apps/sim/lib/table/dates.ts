/**
 * Canonical date-cell semantics for user tables.
 *
 * A `date` cell stores exactly one of two shapes:
 *
 * - **Calendar date** `YYYY-MM-DD` — a timezone-free day.
 * - **Instant with preserved offset** — RFC 3339 `YYYY-MM-DDTHH:mm:ss±HH:MM`
 *   (or `Z`). The wall-time part is what was written and is what every viewer
 *   sees — display never converts across timezones. The offset suffix carries
 *   the true instant for machine consumers (SQL `::timestamptz` casts,
 *   workflows, agents, exports).
 *
 * The interpretation of an input is determined once, at write time: explicit
 * offsets (`Z`, `-07:00`, `PDT`) are preserved as written; naive datetime
 * strings are stamped with the offset of the writer's effective timezone
 * (via {@link NormalizeDateCellOptions.timezone}), else the runtime's local
 * zone — the browser for UI writes, the server (UTC in production) for raw
 * API writes. After that the stored value is final: reads render its wall
 * time verbatim, identically for everyone.
 *
 * This module is pure and shared by server coercion and client rendering.
 * Client code must import it via this concrete path, never the `@/lib/table`
 * barrel (the barrel is server-tainted).
 */

import {
  formatIsoYear,
  formatUtcOffsetSuffix,
  type ZonedWallClockOptions,
  zonedWallClockWithOffset,
} from '@/lib/core/utils/timezone'

const CALENDAR_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const LOCALIZED_CALENDAR_DATE_PATTERN = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/

/**
 * Canonical (or canonical-enough legacy) instant: a literal wall time with an
 * optional fractional-seconds part and an optional offset suffix. The capture
 * groups are the wall-time fields display renders verbatim.
 */
const WALL_INSTANT_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(?:\s*(?:Z|UTC?|GMT|[ECMP][SD]T)|[+-]\d{1,2}(?::?\d{2})?)?$/i

const LOCALIZED_WALL_CLOCK_PATTERN =
  /^(\d{1,2})\/(\d{1,2})\/(\d{4})[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(AM|PM))?$/i

const MONTH_NAME_PATTERN =
  'Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?'
const MONTH_FIRST_DATE_PATTERN = new RegExp(
  `\\b(${MONTH_NAME_PATTERN})\\s+(\\d{1,2})(?:,)?\\s+(\\d{4})\\b`,
  'i'
)
const DAY_FIRST_DATE_PATTERN = new RegExp(
  `\\b(\\d{1,2})\\s+(${MONTH_NAME_PATTERN})(?:,)?\\s+(\\d{4})\\b`,
  'i'
)
const MONTH_BY_ABBREVIATION: Record<string, number> = {
  JAN: 1,
  FEB: 2,
  MAR: 3,
  APR: 4,
  MAY: 5,
  JUN: 6,
  JUL: 7,
  AUG: 8,
  SEP: 9,
  OCT: 10,
  NOV: 11,
  DEC: 12,
}

/**
 * Legacy shape: old CSV imports stored date-only columns as UTC-midnight
 * instants. Treated as calendar dates so historical rows render as pure days
 * rather than a spurious "12:00 AM".
 */
const UTC_MIDNIGHT_PATTERN = /^\d{4}-\d{2}-\d{2}T00:00:00(\.000)?Z$/

/** A time-of-day component anywhere in the string (e.g. `16:04`). */
const TIME_COMPONENT_PATTERN = /\d{1,2}:\d{2}/

/**
 * ISO reduced-precision date forms (`2026`, `2026-07`) parse as UTC per spec,
 * unlike other date-only forms which V8 parses as local time.
 */
const ISO_REDUCED_DATE_PATTERN = /^\d{4}(-\d{2})?$/

/**
 * Fixed offsets (minutes east of UTC) for the RFC 2822 US timezone
 * abbreviations — the only abbreviations `Date.parse` accepts, applied as
 * literal offsets exactly as the engine does.
 */
const US_ABBREVIATION_OFFSET_MINUTES: Record<string, number> = {
  EST: -300,
  EDT: -240,
  CST: -360,
  CDT: -300,
  MST: -420,
  MDT: -360,
  PST: -480,
  PDT: -420,
}

/** True when `value` is a canonical timezone-free calendar date. */
export function isCalendarDateString(value: string): boolean {
  const calendar = value.match(CALENDAR_DATE_PATTERN)
  return Boolean(
    calendar && isValidCalendarDay(Number(calendar[1]), Number(calendar[2]), Number(calendar[3]))
  )
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function toLocalCalendarDate(date: Date): string {
  return `${formatIsoYear(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function toUtcCalendarDate(date: Date): string {
  return `${formatIsoYear(date.getUTCFullYear())}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

/**
 * Trailing offset (minutes east of UTC) of a datetime string, or null when
 * naive. Recognizes exactly what `Date.parse` recognizes: numeric offsets,
 * `Z`/`UT`/`UTC`/`GMT`, and the RFC 2822 US abbreviations. Deliberately does
 * not match a trailing `AM`/`PM`.
 */
function extractExplicitOffsetMinutes(value: string): number | null {
  const numeric = value.match(/([+-])(\d{1,2}):?(\d{2})?\s*$/)
  if (numeric) {
    const sign = numeric[1] === '-' ? -1 : 1
    return sign * (Number(numeric[2]) * 60 + Number(numeric[3] ?? 0))
  }
  if (/(?:Z|UTC?|GMT)$/i.test(value)) return 0
  const abbreviation = value.match(/([ECMP][SD]T)$/i)
  if (abbreviation) return US_ABBREVIATION_OFFSET_MINUTES[abbreviation[1].toUpperCase()]
  return null
}

/** Serializes UTC-read fields of `shifted` as a wall time with `offset`. */
function formatUtcFieldsAsWall(shifted: Date, offsetMinutes: number): string {
  return `${toUtcCalendarDate(shifted)}T${pad(shifted.getUTCHours())}:${pad(
    shifted.getUTCMinutes()
  )}:${pad(shifted.getUTCSeconds())}${formatUtcOffsetSuffix(offsetMinutes)}`
}

/** Serializes local-read fields of `parsed` as a wall time with `offset`. */
function formatLocalFieldsAsWall(parsed: Date, offsetMinutes: number): string {
  return `${toLocalCalendarDate(parsed)}T${pad(parsed.getHours())}:${pad(
    parsed.getMinutes()
  )}:${pad(parsed.getSeconds())}${formatUtcOffsetSuffix(offsetMinutes)}`
}

/** True when numeric year, month, and day fields describe a real calendar day. */
function isValidCalendarDay(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return day <= daysInMonth[month - 1]
}

/** Validates and formats numeric wall-clock fields as naive ISO. */
function formatValidatedWallClock(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number
): string | null {
  if (
    !isValidCalendarDay(year, month, day) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59 ||
    second < 0 ||
    second > 59
  ) {
    return null
  }
  return `${String(year).padStart(4, '0')}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}`
}

/** Reads an ISO-shaped wall clock literally, before runtime timezone normalization. */
function parseIsoWallClock(match: RegExpMatchArray): string | null {
  return formatValidatedWallClock(
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6] ?? 0)
  )
}

/** Reads a supported US numeric wall clock literally, including 12-hour input. */
function parseLocalizedWallClock(match: RegExpMatchArray): string | null {
  const meridiem = match[7]?.toUpperCase()
  let hour = Number(match[4])
  if (meridiem) {
    if (hour < 1 || hour > 12) return null
    hour = (hour % 12) + (meridiem === 'PM' ? 12 : 0)
  }
  return formatValidatedWallClock(
    Number(match[3]),
    Number(match[1]),
    Number(match[2]),
    hour,
    Number(match[5]),
    Number(match[6] ?? 0)
  )
}

interface CalendarFields {
  year: number
  month: number
  day: number
}

/** Extracts literal calendar fields from supported month-name date forms. */
function extractMonthNameCalendar(value: string): CalendarFields | null {
  const monthFirst = value.match(MONTH_FIRST_DATE_PATTERN)
  if (monthFirst) {
    return {
      year: Number(monthFirst[3]),
      month: MONTH_BY_ABBREVIATION[monthFirst[1].slice(0, 3).toUpperCase()],
      day: Number(monthFirst[2]),
    }
  }
  const dayFirst = value.match(DAY_FIRST_DATE_PATTERN)
  if (!dayFirst) return null
  return {
    year: Number(dayFirst[3]),
    month: MONTH_BY_ABBREVIATION[dayFirst[2].slice(0, 3).toUpperCase()],
    day: Number(dayFirst[1]),
  }
}

/** Recovers broader naive `Date.parse` inputs without consulting the runtime timezone. */
function parseNaiveWallClockAsUtc(value: string): string | null {
  const calendar = extractMonthNameCalendar(value)
  if (calendar && !isValidCalendarDay(calendar.year, calendar.month, calendar.day)) return null
  const ms = Date.parse(`${value} UTC`)
  if (Number.isNaN(ms)) return null
  const parsed = new Date(ms)
  if (
    calendar &&
    (parsed.getUTCFullYear() !== calendar.year ||
      parsed.getUTCMonth() + 1 !== calendar.month ||
      parsed.getUTCDate() !== calendar.day)
  ) {
    return null
  }
  return `${toUtcCalendarDate(parsed)}T${pad(parsed.getUTCHours())}:${pad(parsed.getUTCMinutes())}:${pad(parsed.getUTCSeconds())}`
}

export interface NormalizeDateCellOptions {
  /**
   * IANA zone whose offset stamps naive datetime strings (no explicit
   * offset), e.g. a CSV import applying the importing user's timezone.
   * Defaults to the runtime's local zone — the author's wall clock in the
   * browser, UTC on production servers. Throws a RangeError on an invalid
   * zone.
   */
  timezone?: string
  /**
   * Which instant to use when a naive wall time occurs twice during a DST
   * fall-back. Ordinary date cells preserve their historical earlier-instant
   * behavior; instant-like callers may explicitly choose `later`.
   */
  ambiguousTime?: ZonedWallClockOptions['ambiguousTime']
  /** How sub-minute historical offsets are serialized to RFC 3339 minutes. */
  offsetMinuteRounding?: ZonedWallClockOptions['offsetMinuteRounding']
}

/**
 * Normalizes a raw string to a canonical date-cell value, or `null` when it
 * cannot be parsed. Date-only inputs become calendar dates; inputs carrying
 * a time become offset-preserved instants: the wall time survives verbatim
 * (explicit offsets kept as written, naive readings stamped per
 * {@link NormalizeDateCellOptions.timezone}) — see module doc.
 */
export function normalizeDateCellValue(
  raw: string,
  options?: NormalizeDateCellOptions
): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const calendar = trimmed.match(CALENDAR_DATE_PATTERN)
  if (calendar) {
    return isValidCalendarDay(Number(calendar[1]), Number(calendar[2]), Number(calendar[3]))
      ? trimmed
      : null
  }
  const localizedCalendar = trimmed.match(LOCALIZED_CALENDAR_DATE_PATTERN)
  if (localizedCalendar) {
    const month = Number(localizedCalendar[1])
    const day = Number(localizedCalendar[2])
    const year = Number(localizedCalendar[3])
    return isValidCalendarDay(year, month, day)
      ? `${String(year).padStart(4, '0')}-${pad(month)}-${pad(day)}`
      : null
  }
  const isoMatch = trimmed.match(WALL_INSTANT_PATTERN)
  const isoWallClock = isoMatch ? parseIsoWallClock(isoMatch) : undefined
  if (isoWallClock === null) return null
  const localizedMatch = trimmed.match(LOCALIZED_WALL_CLOCK_PATTERN)
  const localizedWallClock = localizedMatch ? parseLocalizedWallClock(localizedMatch) : undefined
  if (localizedWallClock === null) return null
  const ms = Date.parse(trimmed)
  if (Number.isNaN(ms)) return null
  const parsed = new Date(ms)
  const monthNameCalendar = extractMonthNameCalendar(trimmed)
  if (
    monthNameCalendar &&
    !isValidCalendarDay(monthNameCalendar.year, monthNameCalendar.month, monthNameCalendar.day)
  ) {
    return null
  }
  if (!TIME_COMPONENT_PATTERN.test(trimmed)) {
    return ISO_REDUCED_DATE_PATTERN.test(trimmed)
      ? toUtcCalendarDate(parsed)
      : toLocalCalendarDate(parsed)
  }
  const explicitOffset = extractExplicitOffsetMinutes(trimmed)
  if (explicitOffset !== null) {
    // The input's own wall time = the instant shifted east by its offset,
    // read as UTC fields.
    return formatUtcFieldsAsWall(new Date(ms + explicitOffset * 60_000), explicitOffset)
  }
  if (options?.timezone) {
    const wallClock = isoWallClock ?? localizedWallClock ?? parseNaiveWallClockAsUtc(trimmed)
    if (!wallClock) return null
    return zonedWallClockWithOffset(wallClock, options.timezone, {
      ambiguousTime: options.ambiguousTime ?? 'earlier',
      offsetMinuteRounding: options.offsetMinuteRounding,
    })
  }
  return formatLocalFieldsAsWall(parsed, -parsed.getTimezoneOffset())
}

/**
 * Canonical form a stored date cell should be edited (and re-saved) as.
 * Legacy UTC-midnight instants surface as their UTC calendar day (old CSV
 * imports stored date-only columns that way). Unparseable legacy strings
 * pass through so the editor shows what is actually stored.
 */
export function storedDateToEditable(stored: string): string {
  if (UTC_MIDNIGHT_PATTERN.test(stored)) return toUtcCalendarDate(new Date(stored))
  return normalizeDateCellValue(stored) ?? stored
}

interface FormatDateCellDisplayOptions {
  /** Include seconds on instants when non-zero (editor drafts round-trip precision). */
  seconds?: boolean
}

function formatWallForDisplay(
  month: string,
  day: string,
  year: string,
  hour: number,
  minute: string,
  second: number,
  withSeconds: boolean | undefined
): string {
  const hours12 = hour % 12 === 0 ? 12 : hour % 12
  const meridiem = hour < 12 ? 'AM' : 'PM'
  const secondsPart = withSeconds && second !== 0 ? `:${pad(second)}` : ''
  return `${month}/${day}/${year} ${hours12}:${minute}${secondsPart} ${meridiem}`
}

/**
 * Formats a stored date-cell value for display. Calendar dates (and legacy
 * UTC-midnight instants) render as `MM/DD/YYYY`; instants render their
 * **literal wall time** as `MM/DD/YYYY h:mm AM/PM` — identical for every
 * viewer, no timezone conversion. Legacy strings that predate
 * canonicalization render via a runtime-local normalization; unparseable
 * ones are returned as-is.
 */
export function formatDateCellDisplay(
  stored: string,
  options?: FormatDateCellDisplayOptions
): string {
  const calendar = stored.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (calendar) return `${calendar[2]}/${calendar[3]}/${calendar[1]}`
  if (UTC_MIDNIGHT_PATTERN.test(stored)) {
    const date = new Date(stored)
    return `${pad(date.getUTCMonth() + 1)}/${pad(date.getUTCDate())}/${date.getUTCFullYear()}`
  }
  const wall = stored.match(WALL_INSTANT_PATTERN)
  if (wall) {
    const [, year, month, day, hour, minute, second] = wall
    return formatWallForDisplay(
      month,
      day,
      year,
      Number(hour),
      minute,
      Number(second ?? 0),
      options?.seconds
    )
  }
  const canonical = normalizeDateCellValue(stored)
  if (!canonical) return stored
  return formatDateCellDisplay(canonical, options)
}
