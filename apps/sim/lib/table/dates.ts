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

const CALENDAR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/**
 * Canonical (or canonical-enough legacy) instant: a literal wall time with an
 * optional fractional-seconds part and an optional offset suffix. The capture
 * groups are the wall-time fields display renders verbatim.
 */
const WALL_INSTANT_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/

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

/** `Z` for zero, else `±HH:MM`. */
function formatOffsetSuffix(offsetMinutes: number): string {
  if (offsetMinutes === 0) return 'Z'
  const sign = offsetMinutes > 0 ? '+' : '-'
  const abs = Math.abs(offsetMinutes)
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
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
  )}:${pad(shifted.getUTCSeconds())}${formatOffsetSuffix(offsetMinutes)}`
}

/** Serializes local-read fields of `parsed` as a wall time with `offset`. */
function formatLocalFieldsAsWall(parsed: Date, offsetMinutes: number): string {
  return `${toLocalCalendarDate(parsed)}T${pad(parsed.getHours())}:${pad(
    parsed.getMinutes()
  )}:${pad(parsed.getSeconds())}${formatOffsetSuffix(offsetMinutes)}`
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
  const explicitOffset = extractExplicitOffsetMinutes(trimmed)
  if (explicitOffset !== null) {
    // The input's own wall time = the instant shifted east by its offset,
    // read as UTC fields.
    return formatUtcFieldsAsWall(new Date(ms + explicitOffset * 60_000), explicitOffset)
  }
  if (options?.timezone) {
    // `parsed`'s local getters recover the wall-clock fields V8 read from the
    // naive string; stamp them with the requested zone's offset at that time.
    const instant = wallTimeInZoneToUtc(parsed, options.timezone)
    const offsetMinutes = Math.round(zoneOffsetMs(options.timezone, instant) / 60_000)
    return formatLocalFieldsAsWall(parsed, offsetMinutes)
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
