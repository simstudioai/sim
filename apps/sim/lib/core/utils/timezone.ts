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
 * time in `timeZone` — to the exact UTC instant. The offset is read at the
 * target instant, so it is correct for any date including future ones whose
 * offset differs from today's. A wall-clock that falls in the spring-forward
 * gap (a nonexistent local hour) resolves forward by the DST shift, matching
 * how calendar apps treat that once-a-year hour.
 */
export function zonedWallClockToUtc(wallClock: string, timeZone: string): Date {
  const [datePart, timePart] = wallClock.split('T')
  const [year, month, day] = datePart.split('-').map(Number)
  const [hour, minute, second = 0] = timePart.split(':').map(Number)
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second)
  return new Date(utcGuess - timezoneOffsetMs(new Date(utcGuess), timeZone))
}
