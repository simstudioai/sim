import { createLogger } from '@/lib/logs/console/logger'
import { MAX_DAYS_FOR_LAST_N_DAYS, MAX_MONTHS_FOR_LAST_N_MONTHS } from './constants'
import {
  type DateRange,
  formatDate,
  getCurrentWeekStart,
  getLastMonthRange,
  getLastNDaysRange,
  getLastNMonthsRange,
  getLastWeekRange,
  getMonthRange,
  getMonthToDateRange,
  getQuarterRange,
  getThisMonthRange,
  getToday,
  getYearRange,
  getYearToDateRange,
  getYesterday,
  isValidDateRange,
  MONTH_MAP,
} from './date-utils'

const logger = createLogger('DateExtraction')

/**
 * Extracts date ranges from user input using natural language patterns
 */
export function extractDateRanges(input: string): Array<DateRange> {
  const dateRanges: Array<DateRange> = []
  const lower = input.toLowerCase().trim()

  // ============================================
  // PRIORITY 1: Single-day queries (early return)
  // ============================================
  if (/\b(today)\b/.test(lower)) {
    const today = getToday()
    const range: DateRange = {
      start: formatDate(today),
      end: formatDate(today),
    }
    if (isValidDateRange(range)) {
      logger.info('Extracted "today" date range', range)
      return [range]
    }
  }

  if (/\b(yesterday)\b/.test(lower)) {
    const yesterday = getYesterday()
    const range: DateRange = {
      start: formatDate(yesterday),
      end: formatDate(yesterday),
    }
    if (isValidDateRange(range)) {
      logger.info('Extracted "yesterday" date range', range)
      return [range]
    }
  }

  // ============================================
  // PRIORITY 2: Week-based queries
  // ============================================
  if (/\b(this week|current week)\b/.test(lower)) {
    const startDate = getCurrentWeekStart()
    let endDate = getToday()
    let range: DateRange = {
      start: formatDate(startDate),
      end: formatDate(endDate),
    }

    // If start is ahead of end (e.g., Monday morning with limited data),
    // fall back to using getToday() for consistency with Google Ads data lag.
    if (!isValidDateRange(range)) {
      endDate = getToday() // Use getToday() instead of new Date() for consistency
      range = {
        start: formatDate(startDate),
        end: formatDate(endDate),
      }
    }

    if (isValidDateRange(range)) {
      logger.info('Extracted "this week" date range', range)
      return [range]
    }
  }

  if (/\b(last week|past week)\b/.test(lower)) {
    const range = getLastWeekRange()
    if (isValidDateRange(range)) {
      logger.info('Extracted "last week" date range', range)
      return [range]
    }
  }

  // ============================================
  // PRIORITY 3: Month-based queries
  // ============================================
  if (/\b(this month|current month)\b/.test(lower)) {
    const range = getThisMonthRange()
    if (isValidDateRange(range)) {
      logger.info('Extracted "this month" date range', range)
      return [range]
    }
  }

  if (/\b(last month)\b/.test(lower)) {
    const range = getLastMonthRange()
    if (isValidDateRange(range)) {
      logger.info('Extracted "last month" date range', range)
      return [range]
    }
  }

  // ============================================
  // PRIORITY 4: Business intelligence terms
  // ============================================
  if (/\b(year to date|ytd)\b/.test(lower)) {
    const range = getYearToDateRange()
    if (isValidDateRange(range)) {
      logger.info('Extracted "YTD" date range', range)
      return [range]
    }
  }

  if (/\b(month to date|mtd)\b/.test(lower)) {
    const range = getMonthToDateRange()
    if (isValidDateRange(range)) {
      logger.info('Extracted "MTD" date range', range)
      return [range]
    }
  }

  // ============================================
  // PRIORITY 5: Relative period queries ("last N days")
  // ============================================
  // "last 7 days", "last 30 days", "last 90 days", "last N days"
  const lastNDaysMatch = lower.match(/\blast\s+(\d+)\s+days?\b/)
  if (lastNDaysMatch) {
    const days = Number.parseInt(lastNDaysMatch[1])
    if (days > 0 && days <= MAX_DAYS_FOR_LAST_N_DAYS) {
      const range = getLastNDaysRange(days)
      if (isValidDateRange(range)) {
        logger.info('Extracted "last N days" date range', { days, range })
        return [range]
      }
    }
  }

  // ============================================
  // PRIORITY 6: Relative period queries ("last N months")
  // ============================================
  // "last 3 months", "last 6 months", "last N months"
  const lastNMonthsMatch = lower.match(/\blast\s+(\d+)\s+months?\b/)
  if (lastNMonthsMatch) {
    const months = Number.parseInt(lastNMonthsMatch[1])
    if (months > 0 && months <= MAX_MONTHS_FOR_LAST_N_MONTHS) {
      const range = getLastNMonthsRange(months)
      if (isValidDateRange(range)) {
        logger.info('Extracted "last N months" date range', { months, range })
        return [range]
      }
    }
  }

  // ============================================
  // PRIORITY 7: Month name queries
  // ============================================
  // "January 2025", "Jan 2025", "for January", "in January 2025"
  const monthYearMatch = lower.match(
    /\b(?:for|in|during)\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s+(\d{4}))?\b/
  )
  if (monthYearMatch) {
    const monthStr = monthYearMatch[1]
    const yearStr = monthYearMatch[2]
    const year = yearStr ? Number.parseInt(yearStr) : new Date().getFullYear()
    const month = Number.parseInt(MONTH_MAP[monthStr] || '1')

    if (month >= 1 && month <= 12 && year >= 2000 && year <= new Date().getFullYear()) {
      const range = getMonthRange(month, year)
      if (isValidDateRange(range)) {
        logger.info('Extracted month name date range', { month: monthStr, year, range })
        return [range]
      }
    }
  }

  // Also match "January 2025" without "for/in/during" prefix
  const monthYearDirectMatch = lower.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{4})\b/
  )
  if (monthYearDirectMatch) {
    const monthStr = monthYearDirectMatch[1]
    const year = Number.parseInt(monthYearDirectMatch[2])
    const month = Number.parseInt(MONTH_MAP[monthStr] || '1')

    if (month >= 1 && month <= 12 && year >= 2000 && year <= new Date().getFullYear()) {
      const range = getMonthRange(month, year)
      if (isValidDateRange(range)) {
        logger.info('Extracted month name date range (direct)', { month: monthStr, year, range })
        return [range]
      }
    }
  }

  // ============================================
  // PRIORITY 8: Quarter queries
  // ============================================
  // "Q1 2025", "Q2 2025", "first quarter 2025", "Q1 of 2025"
  const quarterMatch = lower.match(
    /\b(?:q|quarter)\s*(\d)\s+(?:of\s+)?(\d{4})\b|\b(first|second|third|fourth)\s+quarter(?:\s+of)?\s+(\d{4})\b/
  )
  if (quarterMatch) {
    let quarter: number
    let year: number

    if (quarterMatch[1] && quarterMatch[2]) {
      // "Q1 2025" format
      quarter = Number.parseInt(quarterMatch[1])
      year = Number.parseInt(quarterMatch[2])
    } else if (quarterMatch[3] && quarterMatch[4]) {
      // "first quarter 2025" format
      const quarterNames: Record<string, number> = {
        first: 1,
        second: 2,
        third: 3,
        fourth: 4,
      }
      quarter = quarterNames[quarterMatch[3].toLowerCase()]
      year = Number.parseInt(quarterMatch[4])
    } else {
      quarter = 0
      year = 0
    }

    if (quarter >= 1 && quarter <= 4 && year >= 2000 && year <= new Date().getFullYear()) {
      const range = getQuarterRange(quarter, year)
      if (isValidDateRange(range)) {
        logger.info('Extracted quarter date range', { quarter, year, range })
        return [range]
      }
    }
  }

  // ============================================
  // PRIORITY 9: Day-Month-Year single date queries (e.g., "8 Nov 2025")
  // ============================================
  const dayMonthYearPattern =
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?),?\s*(\d{4})\b/gi
  const dayMonthYearMatches = [...input.matchAll(dayMonthYearPattern)]
  if (dayMonthYearMatches.length > 0) {
    for (const match of dayMonthYearMatches) {
      const dayStr = match[1]
      const monthStr = match[2].toLowerCase() as keyof typeof MONTH_MAP
      const yearStr = match[3]
      const month = MONTH_MAP[monthStr]
      if (!month) continue

      const day = dayStr.padStart(2, '0')
      const range: DateRange = {
        start: `${yearStr}-${month}-${day}`,
        end: `${yearStr}-${month}-${day}`,
      }

      if (isValidDateRange(range)) {
        logger.info('Extracted single date (day month year) range', { range })
        return [range]
      }
    }
  }

  // ============================================
  // PRIORITY 10: Year-only queries
  // ============================================
  // "2025", "for 2025", "in 2025", "during 2025"
  // Match "for/in/during 2025" first (more specific)
  const yearWithPrefixMatch = lower.match(/\b(?:for|in|during)\s+(20\d{2}|19\d{2})\b/)
  if (yearWithPrefixMatch) {
    const year = Number.parseInt(yearWithPrefixMatch[1])
    if (year >= 2000 && year <= new Date().getFullYear()) {
      const range = getYearRange(year)
      if (isValidDateRange(range)) {
        logger.info('Extracted year-only date range (with prefix)', { year, range })
        return [range]
      }
    }
  }

  // Match standalone year (only if no other date patterns matched)
  // This is less specific, so we check it last and only if no ranges found
  if (dateRanges.length === 0) {
    const standaloneYearMatch = lower.match(/\b(20\d{2}|19\d{2})\b/)
    if (standaloneYearMatch) {
      const year = Number.parseInt(standaloneYearMatch[1])
      // Only match if it's clearly a year (not part of a date range or other number)
      const context = lower.substring(
        Math.max(0, standaloneYearMatch.index! - 10),
        Math.min(lower.length, standaloneYearMatch.index! + standaloneYearMatch[0].length + 10)
      )
      // Don't match if it's part of a date (e.g., "2025-01-01" or "01/01/2025")
      if (!context.match(/\d{1,2}[-/]\d{1,2}[-/]|\d{4}[-/]/)) {
        if (year >= 2000 && year <= new Date().getFullYear()) {
          const range = getYearRange(year)
          if (isValidDateRange(range)) {
            logger.info('Extracted year-only date range (standalone)', { year, range })
            return [range]
          }
        }
      }
    }
  }

  // First, try to match numeric format with "and then": "10/8/2025 to 10/14/2025 and then 10/15/2025 to 10/21/2025"
  // Also handles "from" keyword: "from 9/8/2025 to 9/14/2025 and then 9/15/2025 to 9/21/2025"
  const numericFullPattern =
    /(?:from\s+)?(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+to\s+)(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+and\s+then\s+|\s+and\s+)(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+to\s+)(\d{1,2})\/(\d{1,2})\/(\d{4})/i
  const numericFullMatch = input.match(numericFullPattern)

  if (numericFullMatch) {
    // First range
    const month1 = numericFullMatch[1].padStart(2, '0')
    const day1 = numericFullMatch[2].padStart(2, '0')
    const year1 = numericFullMatch[3]
    const month2 = numericFullMatch[4].padStart(2, '0')
    const day2 = numericFullMatch[5].padStart(2, '0')
    const year2 = numericFullMatch[6]
    dateRanges.push({
      start: `${year1}-${month1}-${day1}`,
      end: `${year2}-${month2}-${day2}`,
    })

    // Second range
    const month3 = numericFullMatch[7].padStart(2, '0')
    const day3 = numericFullMatch[8].padStart(2, '0')
    const year3 = numericFullMatch[9]
    const month4 = numericFullMatch[10].padStart(2, '0')
    const day4 = numericFullMatch[11].padStart(2, '0')
    const year4 = numericFullMatch[12]
    dateRanges.push({
      start: `${year3}-${month3}-${day3}`,
      end: `${year4}-${month4}-${day4}`,
    })

    logger.info('Extracted numeric date ranges with "and then"', { dateRanges })
    return dateRanges
  }

  // Second, try to match the month name pattern with "and then": "Sept 8 to 14 2025 and then 15 to 21 2025"

  const fullPattern =
    /(?:from\s+)?(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2})\s+to\s+(\d{1,2})\s+(\d{4})(?:\s+and\s+then\s+|\s+and\s+)(\d{1,2})\s+to\s+(\d{1,2})\s+(\d{4})/i
  const fullMatch = input.match(fullPattern)

  if (fullMatch) {
    // Extract month from the beginning
    const monthStr = fullMatch[0].match(/^[A-Za-z]+/)?.[0] || ''
    const month = MONTH_MAP[monthStr.toLowerCase()] || '09'

    // First range
    const start1 = fullMatch[1].padStart(2, '0')
    const end1 = fullMatch[2].padStart(2, '0')
    const year1 = fullMatch[3]
    const range1: DateRange = {
      start: `${year1}-${month}-${start1}`,
      end: `${year1}-${month}-${end1}`,
    }

    // Second range (same month)
    const start2 = fullMatch[4].padStart(2, '0')
    const end2 = fullMatch[5].padStart(2, '0')
    const year2 = fullMatch[6]
    const range2: DateRange = {
      start: `${year2}-${month}-${start2}`,
      end: `${year2}-${month}-${end2}`,
    }

    // Validate both ranges
    if (isValidDateRange(range1) && isValidDateRange(range2)) {
      logger.info('Extracted month name date ranges with "and then"', {
        range1,
        range2,
      })
      return [range1, range2]
    }
    logger.warn('Invalid date ranges in comparison query, skipping', {
      range1,
      range2,
    })
  }

  // Fallback to individual patterns
  const patterns = [
    // Month name patterns: "Sept 8 to 14 2025" or "September 8-14, 2025"
    /(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2})(?:\s+to\s+|-|–)(\d{1,2})(?:,?\s+)?(\d{4})/gi,
    // Numeric patterns: "9/8 to 9/14 2025" or "9/8/2025 to 9/14/2025"
    /(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+to\s+|-|–)(\d{1,2})\/(\d{1,2})\/(\d{4})/gi,
    // ISO format: "2025-09-08 to 2025-09-14"
    /(\d{4})-(\d{2})-(\d{2})(?:\s+to\s+|-|–)(\d{4})-(\d{2})-(\d{2})/gi,
  ]

  for (const pattern of patterns) {
    const matches = [...input.matchAll(pattern)]
    for (const match of matches) {
      try {
        let startDate: string
        let endDate: string

        if (match[0].includes('/')) {
          // Numeric format: M/D/YYYY
          const month1 = match[1].padStart(2, '0')
          const day1 = match[2].padStart(2, '0')
          const year1 = match[3]
          const month2 = match[4].padStart(2, '0')
          const day2 = match[5].padStart(2, '0')
          const year2 = match[6]
          startDate = `${year1}-${month1}-${day1}`
          endDate = `${year2}-${month2}-${day2}`
        } else if (match[0].match(/^\d{4}-\d{2}-\d{2}/)) {
          // ISO format
          startDate = `${match[1]}-${match[2]}-${match[3]}`
          endDate = `${match[4]}-${match[5]}-${match[6]}`
        } else {
          // Month name format: "Sept 8 to 14 2025"
          const monthStr = match[0].match(/^[A-Za-z]+/)?.[0] || ''
          const month = MONTH_MAP[monthStr.toLowerCase()] || '01'
          const day1 = match[1].padStart(2, '0')
          const day2 = match[2].padStart(2, '0')
          const year = match[3]
          startDate = `${year}-${month}-${day1}`
          endDate = `${year}-${month}-${day2}`
        }

        const range: DateRange = { start: startDate, end: endDate }
        if (isValidDateRange(range)) {
          dateRanges.push(range)
        } else {
          logger.warn('Invalid date range extracted, skipping', {
            match: match[0],
            range,
          })
        }
      } catch (e) {
        logger.warn('Failed to parse date range', { match: match[0], error: e })
      }
    }
  }

  // Validate all extracted ranges before returning
  const validRanges = dateRanges.filter(isValidDateRange)

  // Deduplicate ranges (same start and end date)
  const uniqueRanges = new Map<string, DateRange>()
  for (const range of validRanges) {
    const key = `${range.start}-${range.end}`
    if (!uniqueRanges.has(key)) {
      uniqueRanges.set(key, range)
    }
  }

  const deduplicatedRanges = Array.from(uniqueRanges.values())

  if (deduplicatedRanges.length > 0) {
    logger.info('Extracted explicit date ranges', {
      count: deduplicatedRanges.length,
      ranges: deduplicatedRanges,
      duplicatesRemoved: validRanges.length - deduplicatedRanges.length,
    })
    return deduplicatedRanges
  }

  return []
}

/**
 * Checks if the user query contains any date-related keywords or patterns
 * Returns true if dates are mentioned, false otherwise
 */
export function containsDateMentions(input: string): boolean {
  const lower = input.toLowerCase()

  // Use specific date patterns first (more accurate, fewer false positives)
  const specificDatePatterns = [
    /\b(today|yesterday|tomorrow)\b/,
    /\b(this|last|next|current)\s+(week|month|year|quarter)\b/,
    /\b(last|next|past|previous)\s+\d+\s+(days?|months?|weeks?|years?)\b/,
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)(uary|ruary|ch|il|e|y|ust|tember|ober|ember)?\s+\d{1,2},?\s+\d{4}\b/i,
    /\b(january|february|march|april|june|july|august|september|october|november|december)\s+\d{4}\b/i,
    /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
    /\b(ytd|mtd)\b/,
    /\bq[1-4]\s+\d{4}\b/i,
  ]

  // Check for specific date patterns first (more accurate)
  if (specificDatePatterns.some((pattern) => pattern.test(input))) {
    return true
  }

  // Fallback: Check for standalone date keywords (less specific, but catches edge cases)
  const dateKeywords = ['today', 'yesterday', 'tomorrow', 'ytd', 'mtd']

  // Only check standalone keywords with word boundaries
  if (dateKeywords.some((keyword) => new RegExp(`\\b${keyword}\\b`).test(lower))) {
    return true
  }

  // Check for date patterns: MM/DD/YYYY, DD-MM-YYYY, YYYY-MM-DD, etc.
  const datePatterns = [
    /\d{1,2}[-/]\d{1,2}[-/]\d{2,4}/, // MM/DD/YYYY or DD-MM-YYYY
    /\d{4}[-/]\d{1,2}[-/]\d{1,2}/, // YYYY-MM-DD
    /\d{1,2}\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i, // 8 Nov or 8th Nov
    /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+\d{1,2}/i, // Nov 8
  ]

  if (datePatterns.some((pattern) => pattern.test(input))) {
    return true
  }

  // Check for "last N" or "next N" patterns
  if (/\b(last|next|past|previous|since|until|from|to)\s+\d+/.test(lower)) {
    return true
  }

  return false
}
