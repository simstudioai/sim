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

/** The IANA timezone the current runtime resolves to (e.g. `America/New_York`). */
export function getBrowserTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
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
 * An instant's wall-clock time in `timeZone` as a naive `yyyy-MM-ddTHH:mm`
 * string. Lets callers reason about a user's local date/time without UTC — e.g.
 * to recover the local date/time a stored task instant represents in its zone.
 */
export function zonedWallClock(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00'
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`
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
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant)
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second')
  )
  return asUtc - instant.getTime()
}

/**
 * Resolves a naive `yyyy-MM-ddTHH:mm[:ss]` wall-clock — interpreted as local
 * time in `timeZone` — to the exact UTC instant. It resolves to the instant
 * whose own offset reproduces the requested wall-clock, which is correct for any
 * date (including future ones whose offset differs from today's) and across DST:
 * a naive single pass reads the offset on the wrong side of a same-day boundary
 * — notably the autumn fall-back hour — and lands an hour off. For an ambiguous
 * fall-back wall-clock the later (post-transition) instant is chosen; a
 * wall-clock in the spring-forward gap (a nonexistent local hour) has no
 * self-consistent instant and resolves forward by the DST shift, matching how
 * calendar apps treat that once-a-year hour.
 */
export function zonedWallClockToUtc(wallClock: string, timeZone: string): Date {
  const [datePart, timePart] = wallClock.split('T')
  const [year, month, day] = datePart.split('-').map(Number)
  const [hour, minute, second = 0] = timePart.split(':').map(Number)
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second)
  const guessOffset = timezoneOffsetMs(new Date(utcGuess), timeZone)
  const candidate = utcGuess - guessOffset
  const candidateOffset = timezoneOffsetMs(new Date(candidate), timeZone)
  if (candidateOffset === guessOffset) return new Date(candidate)
  const adjusted = utcGuess - candidateOffset
  return timezoneOffsetMs(new Date(adjusted), timeZone) === candidateOffset
    ? new Date(adjusted)
    : new Date(candidate)
}
