import type { TimeRange } from '@/stores/logs/filters/types'

/**
 * Calculates start date from a time range string.
 * Returns null for 'All time' or 'Custom range' to indicate the dates
 * should be handled separately.
 * @param timeRange - The time range option selected by the user
 * @param startDate - Optional start date (YYYY-MM-DD) for custom range
 * @returns Date object for the start of the range, or null for 'All time'
 */
export function getStartDateFromTimeRange(
  timeRange: TimeRange,
  startDate?: string,
  referenceTime = Date.now()
): Date | null {
  if (timeRange === 'All time') return null

  if (timeRange === 'Custom range') {
    if (startDate) {
      const date = new Date(startDate)
      if (!startDate.includes('T')) date.setHours(0, 0, 0, 0)
      return date
    }
    return null
  }

  const now = new Date(referenceTime)

  switch (timeRange) {
    case 'Past 30 minutes':
      return new Date(now.getTime() - 30 * 60 * 1000)
    case 'Past hour':
      return new Date(now.getTime() - 60 * 60 * 1000)
    case 'Past 6 hours':
      return new Date(now.getTime() - 6 * 60 * 60 * 1000)
    case 'Past 12 hours':
      return new Date(now.getTime() - 12 * 60 * 60 * 1000)
    case 'Past 24 hours':
      return new Date(now.getTime() - 24 * 60 * 60 * 1000)
    case 'Past 3 days':
      return new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000)
    case 'Past 7 days':
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    case 'Past 14 days':
      return new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)
    case 'Past 30 days':
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    default:
      return new Date(0)
  }
}

/**
 * Gets the end date for a time range.
 * Returns null for preset ranges (uses current time as implicit end).
 * Returns end of day for custom ranges.
 * @param timeRange - The time range option selected by the user
 * @param endDate - Optional end date (YYYY-MM-DD) for custom range
 * @returns Date object for the end of the range, or null for preset ranges
 */
export function getEndDateFromTimeRange(timeRange: TimeRange, endDate?: string): Date | null {
  if (timeRange !== 'Custom range') return null

  if (endDate) {
    const date = new Date(endDate)
    if (!endDate.includes('T')) {
      date.setHours(23, 59, 59, 999)
    } else {
      date.setMilliseconds(999)
    }
    return date
  }

  return null
}
