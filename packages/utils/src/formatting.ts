/**
 * Offset of `timeZone` from UTC at `date`, in minutes east of UTC.
 *
 * `Date` has no timezone-aware offset accessor, so the wall clock is
 * reconstructed as UTC and subtracted from the actual instant.
 */
function getOffsetMinutes(timeZone: string, date: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date)

  const value = (type: string): number => Number(parts.find((part) => part.type === type)?.value)

  // Some engines report midnight as hour 24; the day/month fields already
  // carry the date, so folding it to 0 keeps the instant identical.
  const wallClock = Date.UTC(
    value('year'),
    value('month') - 1,
    value('day'),
    value('hour') % 24,
    value('minute'),
    value('second')
  )

  // The wall clock only has second precision, so compare against the instant
  // truncated to the second.
  return Math.round((wallClock - Math.floor(date.getTime() / 1000) * 1000) / 60000)
}

/**
 * Get a user-friendly timezone abbreviation
 * @param timezone - IANA timezone string
 * @param date - Date to check for DST
 * @returns A simplified timezone string (e.g., "PST" instead of "America/Los_Angeles")
 */
export function getTimezoneAbbreviation(timezone: string, date: Date = new Date()): string {
  if (timezone === 'UTC') return 'UTC'

  const timezoneMap: Record<string, { standard: string; daylight: string }> = {
    'America/Los_Angeles': { standard: 'PST', daylight: 'PDT' },
    'America/Denver': { standard: 'MST', daylight: 'MDT' },
    'America/Chicago': { standard: 'CST', daylight: 'CDT' },
    'America/New_York': { standard: 'EST', daylight: 'EDT' },
    'Europe/London': { standard: 'GMT', daylight: 'BST' },
    'Europe/Paris': { standard: 'CET', daylight: 'CEST' },
    'Asia/Tokyo': { standard: 'JST', daylight: 'JST' }, // Japan doesn't use DST
    'Australia/Sydney': { standard: 'AEST', daylight: 'AEDT' },
    'Asia/Singapore': { standard: 'SGT', daylight: 'SGT' }, // Singapore doesn't use DST
  }

  const zone = timezoneMap[timezone]
  if (zone) {
    // Compare UTC offsets because `format()` also includes the calendar date.
    const januaryOffset = getOffsetMinutes(timezone, new Date(date.getFullYear(), 0, 1))
    const julyOffset = getOffsetMinutes(timezone, new Date(date.getFullYear(), 6, 1))

    if (januaryOffset === julyOffset) {
      return zone.standard
    }

    // Daylight time always moves the clock forward, in either hemisphere, so
    // the smaller of the two offsets is the standard one.
    const standardOffset = Math.min(januaryOffset, julyOffset)
    return getOffsetMinutes(timezone, date) > standardOffset ? zone.daylight : zone.standard
  }

  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'short',
    }).formatToParts(date)
    return parts.find((p) => p.type === 'timeZoneName')?.value || timezone
  } catch {
    return timezone
  }
}

/**
 * Format a date into a human-readable format
 * @param date - The date to format
 * @param timezone - Optional IANA timezone string (e.g., 'America/Los_Angeles', 'UTC')
 * @returns A formatted date string in the format "MMM D, YYYY h:mm A"
 */
export function formatDateTime(date: Date, timezone?: string): string {
  const formattedDate = date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: timezone || undefined,
  })

  if (timezone) {
    const tzAbbr = getTimezoneAbbreviation(timezone, date)
    return `${formattedDate} ${tzAbbr}`
  }

  return formattedDate
}

/**
 * Format a date into a short format
 * @param date - The date to format
 * @returns A formatted date string in the format "MMM D, YYYY"
 */
export function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

/**
 * Format a duration to a human-readable format
 * @param duration - Duration in milliseconds (number) or as string (e.g., "500ms")
 * @param options - Optional formatting options
 * @param options.precision - Number of decimal places for seconds (default: 0), trailing zeros are stripped
 * @returns A formatted duration string, or null if input is null/undefined
 */
export function formatDuration(
  duration: number | string | undefined | null,
  options?: { precision?: number }
): string | null {
  if (duration === undefined || duration === null) {
    return null
  }

  // Parse string durations (e.g., "500ms", "0.44ms", "1234")
  let ms: number
  if (typeof duration === 'string') {
    ms = Number.parseFloat(duration.replace(/[^0-9.-]/g, ''))
    if (!Number.isFinite(ms)) {
      return duration
    }
  } else {
    ms = duration
    // Handle NaN/Infinity (e.g., cancelled blocks with no end time)
    if (!Number.isFinite(ms)) {
      return '\u2014'
    }
  }

  const precision = options?.precision ?? 0

  if (ms < 1) {
    // Zero or near-zero: show "0ms" instead of "0.00ms"
    if (ms === 0 || ms < 0.005) {
      return '0ms'
    }
    // Sub-millisecond: show with 2 decimal places
    return `${ms.toFixed(2)}ms`
  }

  if (ms < 1000) {
    // Milliseconds: round to integer
    return `${Math.round(ms)}ms`
  }

  const seconds = ms / 1000
  if (seconds < 60) {
    if (precision > 0) {
      // Strip trailing zeros (e.g., "5.00s" -> "5s", "5.10s" -> "5.1s")
      return `${seconds.toFixed(precision).replace(/\.?0+$/, '')}s`
    }
    return `${Math.floor(seconds)}s`
  }

  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = Math.floor(seconds % 60)
  if (minutes < 60) {
    return `${minutes}m ${remainingSeconds}s`
  }

  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return `${hours}h ${remainingMinutes}m`
}

/**
 * Formats a date string to relative time (e.g., "2h ago", "3d ago")
 * @param dateString - ISO date string to format
 * @returns A human-readable relative time string
 */
export function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000)

  if (diffInSeconds < 60) {
    return 'just now'
  }
  if (diffInSeconds < 3600) {
    const minutes = Math.floor(diffInSeconds / 60)
    return `${minutes}m ago`
  }
  if (diffInSeconds < 86400) {
    const hours = Math.floor(diffInSeconds / 3600)
    return `${hours}h ago`
  }
  if (diffInSeconds < 604800) {
    const days = Math.floor(diffInSeconds / 86400)
    return `${days}d ago`
  }
  if (diffInSeconds < 2592000) {
    const weeks = Math.floor(diffInSeconds / 604800)
    return `${weeks}w ago`
  }
  if (diffInSeconds < 31536000) {
    const months = Math.floor(diffInSeconds / 2592000)
    return `${months}mo ago`
  }
  const years = Math.floor(diffInSeconds / 31536000)
  return `${years}y ago`
}

/**
 * Formats a count as a lower-bound claim, rounded down to two significant
 * figures (272 → "270+", 5421 → "5,400+"), so a published figure stays true
 * as the underlying count grows.
 * @param count - Non-negative integer count
 * @returns The rounded count with a trailing "+"
 */
export function formatLowerBound(count: number): string {
  const step = 10 ** Math.max(0, Math.floor(Math.log10(count)) - 1)
  return `${(Math.floor(count / step) * step).toLocaleString('en-US')}+`
}
