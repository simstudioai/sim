const LOCALE = 'en-US'
export const MINUTE_MS = 60_000
export const DAY_MS = 24 * 60 * MINUTE_MS

function utcFormat(options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat(LOCALE, { timeZone: 'UTC', ...options })
}

const DATE = {
  short: utcFormat({ month: 'short', day: 'numeric' }),
  full: utcFormat({ month: 'short', day: 'numeric', year: 'numeric' }),
  weekday: utcFormat({ weekday: 'long', month: 'long', day: 'numeric' }),
  /** A day heading, `November 1`. */
  long: utcFormat({ month: 'long', day: 'numeric' }),
  longFull: utcFormat({ month: 'long', day: 'numeric', year: 'numeric' }),
}
const CLOCK_OPTIONS = { hour: 'numeric', minute: '2-digit', hour12: true } as const
const UTC_CLOCK = utcFormat(CLOCK_OPTIONS)
const ORDINAL = new Intl.PluralRules(LOCALE, { type: 'ordinal' })
const SUFFIX: Partial<Record<Intl.LDMLPluralRule, string>> = { one: 'st', two: 'nd', few: 'rd' }

/** The current time, floored to its minute, for reads and clocks that move only by the minute. */
export function currentMinute() {
  return Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS
}

/** Format many instants as ISO calendar days in one reporting time zone. */
export function calendarDayFormatter(timeZone: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format
}

/** Format an ISO calendar day independently of the viewer's time zone. */
export function formatCalendarDate(dateKey: string, style: keyof typeof DATE = 'short') {
  return DATE[style].format(new Date(`${dateKey}T00:00:00Z`))
}

/**
 * An instant's date. Defaults to the viewer's zone; one that renders on the server passes the zone
 * `useBrowserTimezone` settles on, since the server cannot know the viewer's.
 */
export function formatInstantDate(instant: string | number | Date, timeZone?: string) {
  return new Intl.DateTimeFormat(LOCALE, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone,
  }).format(new Date(instant))
}

/** Use the same reference instant for a surface's server and client renders. */
export function formatRelativeTime(timestampMs: number, referenceMs: number) {
  const elapsed = referenceMs - timestampMs
  if (elapsed < MINUTE_MS) return 'now'
  const minutes = Math.floor(elapsed / MINUTE_MS)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}hr${hours === 1 ? '' : 's'} ago`
  if (elapsed < 2 * DAY_MS) return '1d ago'

  const date = new Date(timestampMs)
  const sameYear = date.getUTCFullYear() === new Date(referenceMs).getUTCFullYear()
  return (sameYear ? DATE.short : DATE.full)
    .formatToParts(date)
    .map(({ type, value }) =>
      type === 'day' ? value + (SUFFIX[ORDINAL.select(Number(value))] ?? 'th') : value
    )
    .join('')
}

/** Format an instant on a clock. Pass the viewer's zone for locally composed messages. */
export function formatClockTime(timestampMs: number, timeZone = 'UTC') {
  const clock =
    timeZone === 'UTC' ? UTC_CLOCK : new Intl.DateTimeFormat(LOCALE, { ...CLOCK_OPTIONS, timeZone })
  return clock.format(new Date(timestampMs)).replace(/\s/gu, ' ')
}

/** An absolute date and time, for a record people compare. Defaults to the viewer's zone. */
export function formatTimestamp(timestampMs: number, timeZone?: string) {
  return new Intl.DateTimeFormat(LOCALE, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    ...CLOCK_OPTIONS,
    timeZone,
  })
    .format(new Date(timestampMs))
    .replace(/\s/gu, ' ')
}

/** Minutes are wall-clock positions within a calendar day. The end may extend past midnight. */
export function formatTimeRange(startMinute: number, endMinute: number) {
  const start = startMinute * MINUTE_MS
  const end = endMinute * MINUTE_MS
  if (end < start || Math.floor(start / DAY_MS) !== Math.floor(end / DAY_MS)) {
    return `${formatClockTime(start)}–${formatClockTime(end)}`
  }
  return UTC_CLOCK.formatRange(start, end)
    .replace(/\s*–\s*/u, '–')
    .replace(/\s/gu, ' ')
}
