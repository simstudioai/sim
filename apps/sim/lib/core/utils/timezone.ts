import { truncate } from '@sim/utils/string'

/**
 * A curated fallback for runtimes without `Intl.supportedValuesOf` (e.g. Safari
 * < 15.4), so the timezone picker is never an empty dead-end.
 */
const COMMON_TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Moscow',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Australia/Sydney',
]

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

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** Formats years 0–9999 using ISO's four-digit representation. */
export function formatIsoYear(year: number): string {
  const serialized = String(year)
  return year >= 0 && year <= 9999 ? serialized.padStart(4, '0') : serialized
}

/** Builds a UTC timestamp without `Date.UTC` remapping years 0–99 to 1900–1999. */
function utcTimestamp(wall: WallClockParts): number {
  if (wall.year < 0 || wall.year > 99) {
    return Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second)
  }
  const date = new Date(0)
  date.setUTCFullYear(wall.year, wall.month - 1, wall.day)
  date.setUTCHours(wall.hour, wall.minute, wall.second, 0)
  return date.getTime()
}

/** RFC 3339 offset suffix: `Z` for zero, else `±HH:MM`. */
export function formatUtcOffsetSuffix(offsetMinutes: number): string {
  if (offsetMinutes === 0) return 'Z'
  const sign = offsetMinutes > 0 ? '+' : '-'
  const absoluteMinutes = Math.abs(offsetMinutes)
  return `${sign}${pad(Math.floor(absoluteMinutes / 60))}:${pad(absoluteMinutes % 60)}`
}

function offsetMsFromWallClock(instant: Date, wall: WallClockParts): number {
  const wallAsUtc = utcTimestamp(wall)
  return wallAsUtc - instant.getTime()
}

/** The IANA timezone the current runtime resolves to (e.g. `America/New_York`). */
export function getBrowserTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

/** Whether the runtime recognizes `timezone` as an IANA name. */
export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone })
    return true
  } catch {
    return false
  }
}

/**
 * Rejects a timezone that is not an IANA name.
 *
 * Timezones reach SQL through `AT TIME ZONE`, which takes an identifier rather than
 * a bound parameter, so an unvalidated value off a query string would be
 * interpolated into the statement. Every bucketed aggregate calls this first.
 *
 * Request boundaries should reject the value earlier, through {@link isValidTimezone}
 * in their contract, so a bad query param is a 400 rather than the 500 this throw
 * projects to. This stays as the backstop for every non-HTTP caller.
 */
export function assertValidTimezone(timezone: string): void {
  if (!isValidTimezone(timezone)) {
    // Echoed back trimmed and stripped of line breaks: the rejected value came off
    // a query string, and a raw one carrying newlines or U+2028/U+2029 would forge
    // extra lines in whatever log or error surface renders the message.
    const safe = truncate(timezone.replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, ' '), 64)
    throw new Error(`Invalid timezone: ${safe}. Use an IANA name like "America/Los_Angeles".`)
  }
}

/**
 * Every IANA timezone identifier the runtime knows, for populating a picker;
 * falls back to a curated common set on runtimes without `Intl.supportedValuesOf`.
 */
export function getSupportedTimezones(): string[] {
  const zones =
    typeof Intl.supportedValuesOf === 'function'
      ? Intl.supportedValuesOf('timeZone')
      : COMMON_TIMEZONES
  return zones.includes('UTC') ? zones : ['UTC', ...zones]
}

/** A timezone choice for a picker: the canonical IANA value plus a display label. */
export interface TimezoneOption {
  value: string
  label: string
}

/** The city/locale portion of an IANA id, formatted for display (e.g. `Los Angeles`). */
function timezoneCity(timeZone: string): string {
  return (timeZone.split('/').pop() ?? timeZone).replace(/_/g, ' ')
}

/** `GMT±HH:MM` for an offset expressed in minutes east of UTC (e.g. `GMT-08:00`). */
function formatGmtOffset(offsetMinutes: number): string {
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const absMinutes = Math.abs(offsetMinutes)
  const hours = String(Math.floor(absMinutes / 60)).padStart(2, '0')
  const minutes = String(absMinutes % 60).padStart(2, '0')
  return `GMT${sign}${hours}:${minutes}`
}

/**
 * Timezone options for a picker. Each zone reads as `City (GMT±HH:MM)` — city
 * first, offset for reference — and the list is sorted alphabetically by city,
 * the order usability research (NN/g, Smart Interface Design Patterns) found
 * users expect; offset-sorting confuses people who don't know their offset. The
 * offset is computed live, so it tracks DST automatically. Pair this with the
 * picker's search and a browser-detected default. Values stay canonical IANA
 * ids — what we persist.
 */
export function getTimezoneOptions(): TimezoneOption[] {
  const now = new Date()
  return getSupportedTimezones()
    .map((value) => ({
      value,
      city: timezoneCity(value),
      offsetMinutes: Math.round(timezoneOffsetMs(now, value) / 60_000),
    }))
    .sort((a, b) => a.city.localeCompare(b.city))
    .map(({ value, city, offsetMinutes }) => ({
      value,
      label: `${city} (${formatGmtOffset(offsetMinutes)})`,
    }))
}

/**
 * The wall-clock fields of `instant` in `timeZone`, or in the runtime's local
 * timezone when omitted.
 */
export function getWallClockParts(instant: Date, timeZone?: string): WallClockParts {
  if (timeZone === undefined) {
    return {
      year: instant.getFullYear(),
      month: instant.getMonth() + 1,
      day: instant.getDate(),
      hour: instant.getHours(),
      minute: instant.getMinutes(),
      second: instant.getSeconds(),
    }
  }

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    era: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant)
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value)
  const year = get('year')
  const era = parts.find((part) => part.type === 'era')?.value
  return {
    year: era === 'BC' ? 1 - year : year,
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  }
}

/** Formats an instant as an RFC 3339 wall time in an IANA timezone. */
export function formatInstantInTimeZone(
  instant: Date,
  timeZone: string,
  options?: ZonedWallClockOptions
): string {
  const wall = getWallClockParts(instant, timeZone)
  const wholeSecondInstant = new Date(Math.floor(instant.getTime() / 1000) * 1000)
  const exactOffsetMinutes = offsetMsFromWallClock(wholeSecondInstant, wall) / 60_000
  const offsetMinutes = roundOffsetMinutes(exactOffsetMinutes, options)
  return `${formatIsoYear(wall.year)}-${pad(wall.month)}-${pad(wall.day)}T${pad(wall.hour)}:${pad(wall.minute)}:${pad(wall.second)}${formatUtcOffsetSuffix(offsetMinutes)}`
}

/**
 * An instant's wall-clock time in `timeZone` as a naive `yyyy-MM-ddTHH:mm`
 * string. Lets callers reason about a user's local date/time without UTC — e.g.
 * to recover the local date/time a stored task instant represents in its zone.
 */
export function zonedWallClock(instant: Date, timeZone: string): string {
  const wall = getWallClockParts(instant, timeZone)
  return `${formatIsoYear(wall.year)}-${pad(wall.month)}-${pad(wall.day)}T${pad(wall.hour)}:${pad(wall.minute)}`
}

/** The current wall-clock time in `timeZone` as a naive `yyyy-MM-ddTHH:mm` string. */
export function wallClockNow(timeZone: string): string {
  return zonedWallClock(new Date(), timeZone)
}

/**
 * A `Date` whose device-local fields (year…minute) equal the wall-clock time of
 * `instant` in `timeZone`. It deliberately does NOT represent the same instant —
 * it is a positioning coordinate that lets naive-local layout code (the calendar
 * grid, {@link zonedWallClock}-free pixel offsets) render in `timeZone` without
 * itself being timezone-aware. Never read its `getTime()` as a real timestamp;
 * the true instant always lives alongside it (e.g. a task's `runAt`).
 */
export function zonedClockDate(instant: Date, timeZone: string): Date {
  const [datePart, timePart] = zonedWallClock(instant, timeZone).split('T')
  const [year, month, day] = datePart.split('-').map(Number)
  const [hour, minute] = timePart.split(':').map(Number)
  return new Date(year, month - 1, day, hour, minute)
}

/** The UTC offset (ms, east-positive) of `timeZone` at a given instant. */
function timezoneOffsetMs(instant: Date, timeZone: string): number {
  return offsetMsFromWallClock(instant, getWallClockParts(instant, timeZone))
}

interface ZonedWallClockResolution {
  instant: Date
  offsetMinutes: number
}

export interface ZonedWallClockOptions {
  /** Which real instant to use when the wall clock occurs twice during a DST fall-back. */
  ambiguousTime?: 'earlier' | 'later'
  /** How to serialize rare historical offsets containing seconds into RFC 3339 minutes. */
  offsetMinuteRounding?: 'nearest' | 'floor'
}

function roundOffsetMinutes(exactOffsetMinutes: number, options?: ZonedWallClockOptions): number {
  return options?.offsetMinuteRounding === 'floor'
    ? Math.floor(exactOffsetMinutes)
    : Math.round(exactOffsetMinutes)
}

function resolveZonedWallClock(
  wallClock: string,
  timeZone: string,
  options?: ZonedWallClockOptions
): ZonedWallClockResolution {
  const [datePart, timePart] = wallClock.split('T')
  const [year, month, day] = datePart.split('-').map(Number)
  const [hour, minute, second = 0] = timePart.split(':').map(Number)
  const utcGuess = utcTimestamp({ year, month, day, hour, minute, second })
  const dayMs = 24 * 60 * 60 * 1000
  const offsets = new Set(
    [-dayMs, 0, dayMs].map((distance) => timezoneOffsetMs(new Date(utcGuess + distance), timeZone))
  )
  const candidates = [...offsets].map((offset) => {
    const instantMs = utcGuess - offset
    const actualOffset = timezoneOffsetMs(new Date(instantMs), timeZone)
    return { instantMs, wallClockMs: instantMs + actualOffset }
  })
  const exactCandidate = candidates
    .filter(({ wallClockMs }) => wallClockMs === utcGuess)
    .sort((a, b) =>
      options?.ambiguousTime === 'earlier' ? a.instantMs - b.instantMs : b.instantMs - a.instantMs
    )[0]
  const compatibleCandidate = candidates
    .filter(({ wallClockMs }) => wallClockMs > utcGuess)
    .sort((a, b) => a.wallClockMs - b.wallClockMs || a.instantMs - b.instantMs)[0]
  const chosenCandidate = exactCandidate ?? compatibleCandidate ?? candidates[0]
  const instantMs = chosenCandidate.instantMs
  return {
    instant: new Date(instantMs),
    offsetMinutes: (utcGuess - instantMs) / 60_000,
  }
}

/**
 * Resolves a naive `yyyy-MM-ddTHH:mm[:ss]` wall-clock — interpreted as local
 * time in `timeZone` — to the exact UTC instant. It resolves to the instant
 * whose own offset reproduces the requested wall-clock, which is correct for any
 * date (including future ones whose offset differs from today's) and across DST:
 * a naive single pass reads the offset on the wrong side of a same-day boundary
 * — notably the autumn fall-back hour — and lands an hour off. An ambiguous
 * fall-back wall-clock defaults to the later, post-transition instant, but
 * callers preserving earlier semantics may request the earlier instant. A
 * wall-clock in the spring-forward gap (a nonexistent local hour) has no
 * self-consistent instant and resolves forward by the DST shift, matching how
 * calendar apps treat that once-a-year hour.
 */
export function zonedWallClockToUtc(
  wallClock: string,
  timeZone: string,
  options?: ZonedWallClockOptions
): Date {
  return resolveZonedWallClock(wallClock, timeZone, options).instant
}

/** Stamps a naive wall-clock with the offset selected by the shared timezone resolver. */
export function zonedWallClockWithOffset(
  wallClock: string,
  timeZone: string,
  options?: ZonedWallClockOptions
): string {
  const resolution = resolveZonedWallClock(wallClock, timeZone, options)
  const offsetMinutes = roundOffsetMinutes(resolution.offsetMinutes, options)
  return `${wallClock}${formatUtcOffsetSuffix(offsetMinutes)}`
}
