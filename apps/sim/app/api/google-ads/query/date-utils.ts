/**
 * Shared utilities for date extraction and manipulation
 * Used by extractDateRanges to handle natural language date queries
 */

export type DateRange = { start: string; end: string }

export const MONTH_MAP: Record<string, string> = {
  jan: '01',
  january: '01',
  feb: '02',
  february: '02',
  mar: '03',
  march: '03',
  apr: '04',
  april: '04',
  may: '05',
  jun: '06',
  june: '06',
  jul: '07',
  july: '07',
  aug: '08',
  august: '08',
  sep: '09',
  sept: '09',
  september: '09',
  oct: '10',
  october: '10',
  nov: '11',
  november: '11',
  dec: '12',
  december: '12',
}

/**
 * Validates if a date string is valid and not in the future
 */
export function isValidDate(dateStr: string): boolean {
  const date = new Date(dateStr)
  if (Number.isNaN(date.getTime())) {
    return false
  }
  // Check if date matches the input string (catches invalid dates like Feb 30)
  const [year, month, day] = dateStr.split('-').map(Number)
  if (date.getFullYear() !== year || date.getMonth() + 1 !== month || date.getDate() !== day) {
    return false
  }
  // Don't allow future dates (Google Ads data is historical)
  const today = new Date()
  today.setHours(23, 59, 59, 999) // End of today
  return date <= today
}

/**
 * Validates a date range (start <= end and both are valid)
 */
export function isValidDateRange(range: DateRange): boolean {
  if (!isValidDate(range.start) || !isValidDate(range.end)) {
    return false
  }
  return range.start <= range.end
}

/**
 * Formats a Date object to YYYY-MM-DD string
 */
export function formatDate(date: Date): string {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Gets today's date (yesterday for Google Ads, as data is 1 day behind)
 */
export function getToday(): Date {
  const today = new Date()
  today.setDate(today.getDate() - 1) // Yesterday, as Google Ads data is 1 day behind
  return today
}

/**
 * Gets yesterday's date (2 days ago for Google Ads)
 */
export function getYesterday(): Date {
  const today = new Date()
  today.setDate(today.getDate() - 2) // 2 days ago
  return today
}

/**
 * Calculates Monday of current week
 * Uses getToday() as reference to account for Google Ads data lag
 */
export function getCurrentWeekStart(): Date {
  const today = getToday() // Use Google Ads "today" for consistency
  const currentDay = today.getDay()
  const mondayOffset = currentDay === 0 ? -6 : 1 - currentDay
  const monday = new Date(today)
  monday.setDate(today.getDate() + mondayOffset)
  return monday
}

/**
 * Calculates last week's date range (Monday to Sunday)
 */
export function getLastWeekRange(): DateRange {
  const today = getToday()
  const daysToLastSunday = today.getDay() === 0 ? 7 : today.getDay()
  const lastWeekEnd = new Date(today)
  lastWeekEnd.setDate(today.getDate() - daysToLastSunday)
  const lastWeekStart = new Date(lastWeekEnd)
  lastWeekStart.setDate(lastWeekEnd.getDate() - 6)
  return {
    start: formatDate(lastWeekStart),
    end: formatDate(lastWeekEnd),
  }
}

/**
 * Calculates this month's date range (1st to yesterday)
 */
export function getThisMonthRange(): DateRange {
  const today = getToday()
  const start = new Date(today.getFullYear(), today.getMonth(), 1)
  return {
    start: formatDate(start),
    end: formatDate(today),
  }
}

/**
 * Calculates last month's date range
 */
export function getLastMonthRange(): DateRange {
  const today = getToday()
  const firstThisMonth = new Date(today.getFullYear(), today.getMonth(), 1)
  const lastMonthEnd = new Date(firstThisMonth)
  lastMonthEnd.setDate(firstThisMonth.getDate() - 1)
  const lastMonthStart = new Date(lastMonthEnd.getFullYear(), lastMonthEnd.getMonth(), 1)
  return {
    start: formatDate(lastMonthStart),
    end: formatDate(lastMonthEnd),
  }
}

/**
 * Calculates "last N days" range
 */
export function getLastNDaysRange(days: number): DateRange {
  const today = getToday()
  const start = new Date(today)
  start.setDate(today.getDate() - (days - 1))
  return {
    start: formatDate(start),
    end: formatDate(today),
  }
}

/**
 * Calculates "last N months" range
 */
export function getLastNMonthsRange(months: number): DateRange {
  const today = getToday()
  const end = new Date(today)
  const start = new Date(today)
  start.setMonth(today.getMonth() - months)
  start.setDate(1) // First day of the month
  return {
    start: formatDate(start),
    end: formatDate(end),
  }
}

/**
 * Calculates year-to-date range
 */
export function getYearToDateRange(): DateRange {
  const today = getToday()
  const start = new Date(today.getFullYear(), 0, 1) // January 1st
  return {
    start: formatDate(start),
    end: formatDate(today),
  }
}

/**
 * Calculates month-to-date range
 */
export function getMonthToDateRange(): DateRange {
  const today = getToday()
  const start = new Date(today.getFullYear(), today.getMonth(), 1)
  return {
    start: formatDate(start),
    end: formatDate(today),
  }
}

/**
 * Gets date range for a specific month and year
 */
export function getMonthRange(month: number, year: number): DateRange {
  const start = new Date(year, month - 1, 1)
  const end = new Date(year, month, 0) // Last day of the month
  return {
    start: formatDate(start),
    end: formatDate(end),
  }
}

/**
 * Gets date range for a quarter
 */
export function getQuarterRange(quarter: number, year: number): DateRange {
  const startMonth = (quarter - 1) * 3
  const start = new Date(year, startMonth, 1)
  const endMonth = startMonth + 3
  const end = new Date(year, endMonth, 0) // Last day of the quarter's last month
  return {
    start: formatDate(start),
    end: formatDate(end),
  }
}

/**
 * Gets date range for an entire year
 */
export function getYearRange(year: number): DateRange {
  const start = new Date(year, 0, 1)
  const end = new Date(year, 11, 31)
  return {
    start: formatDate(start),
    end: formatDate(end),
  }
}
