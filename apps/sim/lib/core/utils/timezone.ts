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

/**
 * Curated, human-friendly timezone labels in popularity order. Each label reads
 * as "{Region} Time - {City} ({ABBR})" so the picker shows recognizable names
 * instead of raw IANA paths. Values stay canonical IANA ids (what we persist);
 * every zone the runtime knows but isn't curated still appears below these with
 * an auto-generated "{City} (GMT±X)" label, so coverage is never lost.
 */
const CURATED_TIMEZONES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'UTC', label: 'Coordinated Universal Time (UTC)' },
  { value: 'America/New_York', label: 'US Eastern Time - New York (ET)' },
  { value: 'America/Chicago', label: 'US Central Time - Chicago (CT)' },
  { value: 'America/Denver', label: 'US Mountain Time - Denver (MT)' },
  { value: 'America/Phoenix', label: 'US Mountain Time - Phoenix (MST, no DST)' },
  { value: 'America/Los_Angeles', label: 'US Pacific Time - Los Angeles (PT)' },
  { value: 'America/Anchorage', label: 'US Alaska Time - Anchorage (AKT)' },
  { value: 'Pacific/Honolulu', label: 'US Hawaii Time - Honolulu (HST)' },
  { value: 'America/Toronto', label: 'Canada Eastern Time - Toronto (ET)' },
  { value: 'America/Winnipeg', label: 'Canada Central Time - Winnipeg (CT)' },
  { value: 'America/Edmonton', label: 'Canada Mountain Time - Edmonton (MT)' },
  { value: 'America/Vancouver', label: 'Canada Pacific Time - Vancouver (PT)' },
  { value: 'America/Halifax', label: 'Canada Atlantic Time - Halifax (AT)' },
  { value: 'America/St_Johns', label: "Canada Newfoundland Time - St. John's (NT)" },
  { value: 'America/Mexico_City', label: 'Mexico Central Time - Mexico City (CST)' },
  { value: 'America/Bogota', label: 'Colombia Time - Bogotá (COT)' },
  { value: 'America/Lima', label: 'Peru Time - Lima (PET)' },
  { value: 'America/Sao_Paulo', label: 'Brazil Time - São Paulo (BRT)' },
  { value: 'America/Argentina/Buenos_Aires', label: 'Argentina Time - Buenos Aires (ART)' },
  { value: 'America/Santiago', label: 'Chile Time - Santiago (CLT)' },
  { value: 'Europe/London', label: 'UK Time - London (GMT/BST)' },
  { value: 'Europe/Dublin', label: 'Ireland Time - Dublin (GMT/IST)' },
  { value: 'Europe/Lisbon', label: 'Portugal Time - Lisbon (WET)' },
  { value: 'Europe/Paris', label: 'Central European Time - Paris (CET)' },
  { value: 'Europe/Berlin', label: 'Central European Time - Berlin (CET)' },
  { value: 'Europe/Madrid', label: 'Central European Time - Madrid (CET)' },
  { value: 'Europe/Rome', label: 'Central European Time - Rome (CET)' },
  { value: 'Europe/Amsterdam', label: 'Central European Time - Amsterdam (CET)' },
  { value: 'Europe/Zurich', label: 'Central European Time - Zurich (CET)' },
  { value: 'Europe/Stockholm', label: 'Central European Time - Stockholm (CET)' },
  { value: 'Europe/Athens', label: 'Eastern European Time - Athens (EET)' },
  { value: 'Europe/Helsinki', label: 'Eastern European Time - Helsinki (EET)' },
  { value: 'Europe/Istanbul', label: 'Turkey Time - Istanbul (TRT)' },
  { value: 'Europe/Moscow', label: 'Moscow Time - Moscow (MSK)' },
  { value: 'Africa/Lagos', label: 'West Africa Time - Lagos (WAT)' },
  { value: 'Africa/Cairo', label: 'Egypt Time - Cairo (EET)' },
  { value: 'Africa/Nairobi', label: 'East Africa Time - Nairobi (EAT)' },
  { value: 'Africa/Johannesburg', label: 'South Africa Time - Johannesburg (SAST)' },
  { value: 'Asia/Jerusalem', label: 'Israel Time - Jerusalem (IST)' },
  { value: 'Asia/Riyadh', label: 'Arabia Time - Riyadh (AST)' },
  { value: 'Asia/Dubai', label: 'Gulf Time - Dubai (GST)' },
  { value: 'Asia/Karachi', label: 'Pakistan Time - Karachi (PKT)' },
  { value: 'Asia/Kolkata', label: 'India Time - Kolkata (IST)' },
  { value: 'Asia/Dhaka', label: 'Bangladesh Time - Dhaka (BST)' },
  { value: 'Asia/Bangkok', label: 'Indochina Time - Bangkok (ICT)' },
  { value: 'Asia/Jakarta', label: 'Western Indonesia Time - Jakarta (WIB)' },
  { value: 'Asia/Singapore', label: 'Singapore Time - Singapore (SGT)' },
  { value: 'Asia/Hong_Kong', label: 'Hong Kong Time - Hong Kong (HKT)' },
  { value: 'Asia/Shanghai', label: 'China Time - Shanghai (CST)' },
  { value: 'Asia/Taipei', label: 'Taipei Time - Taipei (CST)' },
  { value: 'Asia/Seoul', label: 'Korea Time - Seoul (KST)' },
  { value: 'Asia/Tokyo', label: 'Japan Time - Tokyo (JST)' },
  { value: 'Australia/Perth', label: 'Australia Western Time - Perth (AWST)' },
  { value: 'Australia/Adelaide', label: 'Australia Central Time - Adelaide (ACT)' },
  { value: 'Australia/Brisbane', label: 'Australia Eastern Time - Brisbane (AEST, no DST)' },
  { value: 'Australia/Sydney', label: 'Australia Eastern Time - Sydney (AET)' },
  { value: 'Pacific/Auckland', label: 'New Zealand Time - Auckland (NZT)' },
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
 * Legacy IANA aliases (from older ICU data) mapped to the canonical id used in
 * {@link CURATED_TIMEZONES}, so a runtime that reports the alias doesn't surface
 * it as a duplicate of an already-curated zone.
 */
const TIMEZONE_ALIASES: Record<string, string> = {
  'Asia/Calcutta': 'Asia/Kolkata',
  'America/Buenos_Aires': 'America/Argentina/Buenos_Aires',
}

/** A timezone choice for a picker: the canonical IANA value plus a display label. */
export interface TimezoneOption {
  value: string
  label: string
}

/** `GMT±H` / `GMT±H:MM` for `timeZone` at the current instant (e.g. `GMT-7`). */
function formatGmtOffset(timeZone: string): string {
  const offsetMinutes = Math.round(timezoneOffsetMs(new Date(), timeZone) / 60_000)
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const absMinutes = Math.abs(offsetMinutes)
  const hours = Math.floor(absMinutes / 60)
  const minutes = absMinutes % 60
  return minutes === 0
    ? `GMT${sign}${hours}`
    : `GMT${sign}${hours}:${String(minutes).padStart(2, '0')}`
}

/**
 * Timezone options for the picker: the curated, human-friendly zones
 * ({@link CURATED_TIMEZONES}) first in popularity order, then every remaining
 * zone the runtime knows — alphabetically, with an auto-generated
 * "{City} (GMT±X)" label — so the common picks read naturally while full
 * coverage stays searchable.
 */
export function getTimezoneOptions(): TimezoneOption[] {
  const curatedValues = new Set(CURATED_TIMEZONES.map((option) => option.value))
  const rest = getSupportedTimezones()
    .filter((tz) => {
      const canonical = TIMEZONE_ALIASES[tz] ?? tz
      return !curatedValues.has(canonical)
    })
    .sort((a, b) => a.localeCompare(b))
    .map((tz) => ({ value: tz, label: `${tz.replace(/_/g, ' ')} (${formatGmtOffset(tz)})` }))
  return [...CURATED_TIMEZONES, ...rest]
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
