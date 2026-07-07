/**
 * Canonical date-cell semantics for user tables.
 *
 * A `date` cell stores exactly one of two shapes:
 *
 * - **Calendar date** `YYYY-MM-DD` — a timezone-free day. Never converted;
 *   renders identically for every viewer.
 * - **Instant** — a full UTC ISO-8601 string (`Date.prototype.toISOString`
 *   output). Rendered in the viewer's local timezone.
 *
 * Inputs with an explicit offset (`Z`, `-07:00`, `PDT`) convert exactly.
 * Naive datetime strings are interpreted in the runtime's local timezone:
 * the browser's when written through the UI (the author's wall clock), the
 * server's (UTC in production) for CSV imports and raw API writes.
 *
 * This module is pure and shared by server coercion and client rendering.
 * Client code must import it via this concrete path, never the `@/lib/table`
 * barrel (the barrel is server-tainted).
 */

const CALENDAR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/**
 * Legacy shape: old CSV imports stored date-only columns as UTC-midnight
 * instants. Treated as calendar dates (UTC day) so historical rows don't
 * shift a day for viewers west of Greenwich.
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
 * Trailing timezone information V8's parser recognizes: `Z`, `UT`/`UTC`/`GMT`,
 * US abbreviations (`PST`, `EDT`, …), and numeric offsets (`+05`, `-0700`,
 * `+00:00`). Deliberately does not match a trailing `AM`/`PM`.
 */
const EXPLICIT_OFFSET_PATTERN = /(?:Z|UTC?|GMT|[ECMP][SD]T)$|[+-]\d{1,2}(?::?\d{2})?$/i

/** True when `value` is a canonical timezone-free calendar date. */
export function isCalendarDateString(value: string): boolean {
  return CALENDAR_DATE_PATTERN.test(value) && !Number.isNaN(Date.parse(value))
}

/** A wall-clock reading of an instant in some timezone. */
export interface WallClockParts {
  year: number
  /** 1-based month. */
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

/**
 * The wall-clock reading of `date` in `timeZone` — or in the runtime's local
 * zone when omitted. Throws a RangeError on an invalid IANA zone — callers
 * validate at the boundary.
 */
export function getWallClockParts(date: Date, timeZone?: string): WallClockParts {
  if (!timeZone) {
    return {
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      day: date.getDate(),
      hour: date.getHours(),
      minute: date.getMinutes(),
      second: date.getSeconds(),
    }
  }
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date)
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  }
}

/** Offset of `timeZone` from UTC (ms east) at the moment `at`. */
function zoneOffsetMs(timeZone: string, at: Date): number {
  const wall = getWallClockParts(at, timeZone)
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second)
  return asUtc - at.getTime()
}

/**
 * Converts a wall-clock reading in `timeZone` to the UTC instant it denotes.
 * Two-pass so readings near a DST transition resolve with the offset in
 * force at that wall time.
 */
function wallTimeInZoneToUtc(wall: Date, timeZone: string): Date {
  const guess = Date.UTC(
    wall.getFullYear(),
    wall.getMonth(),
    wall.getDate(),
    wall.getHours(),
    wall.getMinutes(),
    wall.getSeconds(),
    wall.getMilliseconds()
  )
  const adjusted = guess - zoneOffsetMs(timeZone, new Date(guess))
  return new Date(guess - zoneOffsetMs(timeZone, new Date(adjusted)))
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function toLocalCalendarDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function toUtcCalendarDate(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

export interface NormalizeDateCellOptions {
  /**
   * IANA zone used to interpret naive datetime strings (no explicit offset),
   * e.g. a CSV import applying the importing user's timezone. Defaults to the
   * runtime's local zone — the author's wall clock in the browser, UTC on
   * production servers. Throws a RangeError on an invalid zone.
   */
  timezone?: string
}

/**
 * Normalizes a raw string to a canonical date-cell value, or `null` when it
 * cannot be parsed. Date-only inputs become calendar dates; inputs carrying a
 * time become UTC instants (naive ones interpreted per
 * {@link NormalizeDateCellOptions.timezone} — see module doc).
 */
export function normalizeDateCellValue(
  raw: string,
  options?: NormalizeDateCellOptions
): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (CALENDAR_DATE_PATTERN.test(trimmed)) {
    return Number.isNaN(Date.parse(trimmed)) ? null : trimmed
  }
  const ms = Date.parse(trimmed)
  if (Number.isNaN(ms)) return null
  const parsed = new Date(ms)
  if (!TIME_COMPONENT_PATTERN.test(trimmed)) {
    return ISO_REDUCED_DATE_PATTERN.test(trimmed)
      ? toUtcCalendarDate(parsed)
      : toLocalCalendarDate(parsed)
  }
  if (options?.timezone && !EXPLICIT_OFFSET_PATTERN.test(trimmed)) {
    // `parsed`'s local getters recover the wall-clock fields V8 read from the
    // naive string; reinterpret that reading in the requested zone.
    return wallTimeInZoneToUtc(parsed, options.timezone).toISOString()
  }
  return parsed.toISOString()
}

/**
 * Canonical form a stored date cell should be edited (and re-saved) as.
 * Legacy UTC-midnight instants surface as their UTC calendar day — feeding
 * them to `new Date()`-based editors as instants would shift the day for
 * viewers west of Greenwich. Unparseable legacy strings pass through so the
 * editor shows what is actually stored.
 */
export function storedDateToEditable(stored: string): string {
  if (UTC_MIDNIGHT_PATTERN.test(stored)) return toUtcCalendarDate(new Date(stored))
  return normalizeDateCellValue(stored) ?? stored
}

interface FormatDateCellDisplayOptions {
  /** Include seconds on instants when non-zero (editor drafts round-trip precision). */
  seconds?: boolean
  /** IANA zone instants render in. Defaults to the runtime's local zone. */
  timeZone?: string
}

/**
 * Formats a stored date-cell value for display. Calendar dates (and legacy
 * UTC-midnight instants) render as `MM/DD/YYYY`; instants render in the
 * viewer's effective timezone as `MM/DD/YYYY h:mm AM/PM`. Unparseable
 * strings (pre-canonicalization rows) are returned as-is.
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
  const ms = Date.parse(stored)
  if (Number.isNaN(ms)) return stored
  const wall = getWallClockParts(new Date(ms), options?.timeZone)
  const day = `${pad(wall.month)}/${pad(wall.day)}/${wall.year}`
  const hours12 = wall.hour % 12 === 0 ? 12 : wall.hour % 12
  const meridiem = wall.hour < 12 ? 'AM' : 'PM'
  const secondsPart = options?.seconds && wall.second !== 0 ? `:${pad(wall.second)}` : ''
  return `${day} ${hours12}:${pad(wall.minute)}${secondsPart} ${meridiem}`
}
