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

  if (timezone in timezoneMap) {
    const januaryDate = new Date(date.getFullYear(), 0, 1)
    const julyDate = new Date(date.getFullYear(), 6, 1)

    const januaryFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'short',
    })

    const julyFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'short',
    })

    const isDSTObserved = januaryFormatter.format(januaryDate) !== julyFormatter.format(julyDate)

    if (isDSTObserved) {
      const currentFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        timeZoneName: 'short',
      })

      const isDST = currentFormatter.format(date) !== januaryFormatter.format(januaryDate)
      return isDST ? timezoneMap[timezone].daylight : timezoneMap[timezone].standard
    }

    return timezoneMap[timezone].standard
  }

  return timezone
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
 * Formats a date string to absolute format for tooltip display
 * @param dateString - ISO date string to format
 * @returns A formatted date string (e.g., "Jan 22, 2026, 01:30 PM")
 */
export function formatAbsoluteDate(dateString: string): string {
  const date = new Date(dateString)
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Format a time into a short format
 * @param date - The date to format
 * @returns A formatted time string in the format "h:mm A"
 */
export function formatTime(date: Date): string {
  return date.toLocaleString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

/**
 * Format a time with seconds and timezone
 * @param date - The date to format
 * @param includeTimezone - Whether to include the timezone abbreviation
 * @returns A formatted time string in the format "h:mm:ss AM/PM TZ"
 */
export function formatTimeWithSeconds(date: Date, includeTimezone = true): string {
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
    timeZoneName: includeTimezone ? 'short' : undefined,
  })
}

/**
 * Format an ISO timestamp into a compact format for UI display
 * @param iso - ISO timestamp string
 * @returns A formatted string in "MM-DD HH:mm" format
 */
export function formatCompactTimestamp(iso: string): string {
  try {
    const d = new Date(iso)
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    const hh = String(d.getHours()).padStart(2, '0')
    const min = String(d.getMinutes()).padStart(2, '0')
    return `${mm}-${dd} ${hh}:${min}`
  } catch {
    return iso
  }
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
      return '—'
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
