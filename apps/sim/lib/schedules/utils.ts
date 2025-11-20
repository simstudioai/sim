import { Cron } from 'croner'
import cronstrue from 'cronstrue'
import { createLogger } from '@/lib/logs/console/logger'
import { formatDateTime } from '@/lib/utils'

const logger = createLogger('ScheduleUtils')

/**
 * Validates a cron expression and returns validation results
 * @param cronExpression - The cron expression to validate
 * @param timezone - Optional IANA timezone string (e.g., 'America/Los_Angeles'). Defaults to 'UTC'
 * @returns Validation result with isValid flag, error message, and next run date
 */
export function validateCronExpression(
  cronExpression: string,
  timezone?: string
): {
  isValid: boolean
  error?: string
  nextRun?: Date
} {
  if (!cronExpression?.trim()) {
    return {
      isValid: false,
      error: 'Cron expression cannot be empty',
    }
  }

  try {
    // Validate with timezone if provided for accurate next run calculation
    const cron = new Cron(cronExpression, timezone ? { timezone } : undefined)
    const nextRun = cron.nextRun()

    if (!nextRun) {
      return {
        isValid: false,
        error: 'Cron expression produces no future occurrences',
      }
    }

    return {
      isValid: true,
      nextRun,
    }
  } catch (error) {
    return {
      isValid: false,
      error: error instanceof Error ? error.message : 'Invalid cron expression syntax',
    }
  }
}

export interface SubBlockValue {
  value: string
}

export interface BlockState {
  type: string
  subBlocks: Record<string, SubBlockValue | any>
  [key: string]: any
}

export const DAY_MAP: Record<string, number> = {
  MON: 1,
  TUE: 2,
  WED: 3,
  THU: 4,
  FRI: 5,
  SAT: 6,
  SUN: 0,
}

/**
 * Safely extract a value from a block's subBlocks
 */
export function getSubBlockValue(block: BlockState, id: string): string {
  const subBlock = block.subBlocks[id] as SubBlockValue | undefined
  return subBlock?.value || ''
}

/**
 * Parse and extract hours and minutes from a time string
 * @param timeString - Time string in format "HH:MM"
 * @returns Array with [hours, minutes] as numbers, or [9, 0] as default
 */
export function parseTimeString(timeString: string | undefined | null): [number, number] {
  if (!timeString || !timeString.includes(':')) {
    return [9, 0] // Default to 9:00 AM
  }

  const [hours, minutes] = timeString.split(':').map(Number)
  return [Number.isNaN(hours) ? 9 : hours, Number.isNaN(minutes) ? 0 : minutes]
}

/**
 * Get time values from starter block for scheduling
 * @param starterBlock - The starter block containing schedule configuration
 * @returns Object with parsed time values
 */
export function getScheduleTimeValues(starterBlock: BlockState): {
  scheduleTime: string
  scheduleStartAt?: string
  minutesInterval: number
  hourlyMinute: number
  dailyTime: [number, number]
  weeklyDay: number
  weeklyTime: [number, number]
  monthlyDay: number
  monthlyTime: [number, number]
  cronExpression: string | null
  timezone: string
} {
  // Extract schedule time (common field that can override others)
  const scheduleTime = getSubBlockValue(starterBlock, 'scheduleTime')

  // Extract schedule start date
  const scheduleStartAt = getSubBlockValue(starterBlock, 'scheduleStartAt')

  // Extract timezone (default to UTC)
  const timezone = getSubBlockValue(starterBlock, 'timezone') || 'UTC'

  // Get minutes interval (default to 15)
  const minutesIntervalStr = getSubBlockValue(starterBlock, 'minutesInterval')
  const minutesInterval = Number.parseInt(minutesIntervalStr) || 15

  // Get hourly minute (default to 0)
  const hourlyMinuteStr = getSubBlockValue(starterBlock, 'hourlyMinute')
  const hourlyMinute = Number.parseInt(hourlyMinuteStr) || 0

  // Get daily time
  const dailyTime = parseTimeString(getSubBlockValue(starterBlock, 'dailyTime'))

  // Get weekly config
  const weeklyDayStr = getSubBlockValue(starterBlock, 'weeklyDay') || 'MON'
  const weeklyDay = DAY_MAP[weeklyDayStr] || 1
  const weeklyTime = parseTimeString(getSubBlockValue(starterBlock, 'weeklyDayTime'))

  // Get monthly config
  const monthlyDayStr = getSubBlockValue(starterBlock, 'monthlyDay')
  const monthlyDay = Number.parseInt(monthlyDayStr) || 1
  const monthlyTime = parseTimeString(getSubBlockValue(starterBlock, 'monthlyTime'))

  const cronExpression = getSubBlockValue(starterBlock, 'cronExpression') || null

  return {
    scheduleTime,
    scheduleStartAt,
    timezone,
    minutesInterval,
    hourlyMinute,
    dailyTime,
    weeklyDay,
    weeklyTime,
    monthlyDay,
    monthlyTime,
    cronExpression,
  }
}

/**
 * Helper function to create a date with the specified time in the correct timezone.
 * This function calculates the corresponding UTC time for a given local date,
 * local time, and IANA timezone name, correctly handling DST.
 *
 * @param dateInput Date string or Date object representing the local date.
 * @param timeStr Time string in format "HH:MM" representing the local time.
 * @param timezone IANA timezone string (e.g., 'America/Los_Angeles', 'Europe/Paris'). Defaults to 'UTC'.
 * @returns Date object representing the absolute point in time (UTC).
 */
export function createDateWithTimezone(
  dateInput: string | Date,
  timeStr: string,
  timezone = 'UTC'
): Date {
  try {
    // 1. Parse the base date and target time
    const baseDate = typeof dateInput === 'string' ? new Date(dateInput) : new Date(dateInput)
    const [targetHours, targetMinutes] = parseTimeString(timeStr)

    // Ensure baseDate reflects the date part only, setting time to 00:00:00 in UTC
    // This prevents potential issues if dateInput string includes time/timezone info.
    const year = baseDate.getUTCFullYear()
    const monthIndex = baseDate.getUTCMonth() // 0-based
    const day = baseDate.getUTCDate()

    // 2. Create a tentative UTC Date object using the target date and time components
    // This assumes, for a moment, that the target H:M were meant for UTC.
    const tentativeUTCDate = new Date(
      Date.UTC(year, monthIndex, day, targetHours, targetMinutes, 0)
    )

    // 3. If the target timezone is UTC, we're done.
    if (timezone === 'UTC') {
      return tentativeUTCDate
    }

    // 4. Format the tentative UTC date into the target timezone's local time components.
    // Use 'en-CA' locale for unambiguous YYYY-MM-DD and 24-hour format.
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit', // Use 2-digit for consistency
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23', // Use 24-hour format (00-23)
    })

    const parts = formatter.formatToParts(tentativeUTCDate)
    const getPart = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((p) => p.type === type)?.value

    const formattedYear = Number.parseInt(getPart('year') || '0', 10)
    const formattedMonth = Number.parseInt(getPart('month') || '0', 10) // 1-based
    const formattedDay = Number.parseInt(getPart('day') || '0', 10)
    const formattedHour = Number.parseInt(getPart('hour') || '0', 10)
    const formattedMinute = Number.parseInt(getPart('minute') || '0', 10)

    // Create a Date object representing the local time *in the target timezone*
    // when the tentative UTC date occurs.
    // Note: month needs to be adjusted back to 0-based for Date.UTC()
    const actualLocalTimeInTargetZone = Date.UTC(
      formattedYear,
      formattedMonth - 1,
      formattedDay,
      formattedHour,
      formattedMinute,
      0 // seconds
    )

    // 5. Calculate the difference between the intended local time and the actual local time
    // that resulted from the tentative UTC date. This difference represents the offset
    // needed to adjust the UTC time.
    // Create the intended local time as a UTC timestamp for comparison purposes.
    const intendedLocalTimeAsUTC = Date.UTC(year, monthIndex, day, targetHours, targetMinutes, 0)

    // The offset needed for UTC time is the difference between the intended local time
    // and the actual local time (when both are represented as UTC timestamps).
    const offsetMilliseconds = intendedLocalTimeAsUTC - actualLocalTimeInTargetZone

    // 6. Adjust the tentative UTC date by the calculated offset.
    const finalUTCTimeMilliseconds = tentativeUTCDate.getTime() + offsetMilliseconds
    const finalDate = new Date(finalUTCTimeMilliseconds)

    return finalDate
  } catch (e) {
    logger.error('Error creating date with timezone:', e, { dateInput, timeStr, timezone })
    // Fallback to a simple UTC interpretation on error
    try {
      const baseDate = typeof dateInput === 'string' ? new Date(dateInput) : new Date(dateInput)
      const [hours, minutes] = parseTimeString(timeStr)
      const year = baseDate.getUTCFullYear()
      const monthIndex = baseDate.getUTCMonth()
      const day = baseDate.getUTCDate()
      return new Date(Date.UTC(year, monthIndex, day, hours, minutes, 0))
    } catch (fallbackError) {
      logger.error('Error during fallback date creation:', fallbackError)
      throw new Error(
        `Failed to create date with timezone (${timezone}): ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`
      )
    }
  }
}

/**
 * Generate cron expression based on schedule type and values
 *
 * IMPORTANT: The generated cron expressions use local time values (hours/minutes)
 * from the user's configured timezone. When used with Croner, pass the timezone
 * option to ensure proper scheduling:
 *
 * Example:
 *   const cronExpr = generateCronExpression('daily', { dailyTime: [14, 30], timezone: 'America/Los_Angeles' })
 *   const cron = new Cron(cronExpr, { timezone: 'America/Los_Angeles' })
 *
 * This will schedule the job at 2:30 PM Pacific Time, which Croner will correctly
 * convert to the appropriate UTC time, handling DST transitions automatically.
 *
 * @param scheduleType - Type of schedule (minutes, hourly, daily, weekly, monthly, custom)
 * @param scheduleValues - Object containing schedule configuration including timezone
 * @returns Cron expression string representing the schedule in local time
 */
export function generateCronExpression(
  scheduleType: string,
  scheduleValues: ReturnType<typeof getScheduleTimeValues>
): string {
  switch (scheduleType) {
    case 'minutes':
      return `*/${scheduleValues.minutesInterval} * * * *`

    case 'hourly':
      return `${scheduleValues.hourlyMinute} * * * *`

    case 'daily': {
      const [hours, minutes] = scheduleValues.dailyTime
      return `${minutes} ${hours} * * *`
    }

    case 'weekly': {
      const [hours, minutes] = scheduleValues.weeklyTime
      return `${minutes} ${hours} * * ${scheduleValues.weeklyDay}`
    }

    case 'monthly': {
      const [hours, minutes] = scheduleValues.monthlyTime
      return `${minutes} ${hours} ${scheduleValues.monthlyDay} * *`
    }

    case 'custom': {
      if (!scheduleValues.cronExpression?.trim()) {
        throw new Error('Custom schedule requires a valid cron expression')
      }
      return scheduleValues.cronExpression
    }

    default:
      throw new Error(`Unsupported schedule type: ${scheduleType}`)
  }
}

/**
 * Calculate the next run time based on schedule configuration
 * Uses Croner library with timezone support for accurate scheduling across timezones and DST transitions
 * @param scheduleType - Type of schedule (minutes, hourly, daily, etc)
 * @param scheduleValues - Object with schedule configuration values
 * @param lastRanAt - Optional last execution time
 * @returns Date object for next execution time
 */
export function calculateNextRunTime(
  scheduleType: string,
  scheduleValues: ReturnType<typeof getScheduleTimeValues>,
  lastRanAt?: Date | null
): Date {
  // Get timezone (default to UTC)
  const timezone = scheduleValues.timezone || 'UTC'

  // Get the current time
  const baseDate = new Date()

  // If we have both a start date and time, use them together with timezone awareness
  if (scheduleValues.scheduleStartAt && scheduleValues.scheduleTime) {
    try {
      logger.info(
        `Creating date with: startAt=${scheduleValues.scheduleStartAt}, time=${scheduleValues.scheduleTime}, timezone=${timezone}`
      )

      const combinedDate = createDateWithTimezone(
        scheduleValues.scheduleStartAt,
        scheduleValues.scheduleTime,
        timezone
      )

      logger.info(`Combined date result: ${combinedDate.toISOString()}`)

      // If the combined date is in the future, use it as our next run time
      if (combinedDate > baseDate) {
        return combinedDate
      }
    } catch (e) {
      logger.error('Error combining scheduled date and time:', e)
    }
  }
  // If only scheduleStartAt is set (without scheduleTime), parse it directly
  else if (scheduleValues.scheduleStartAt) {
    try {
      // Check if the date string already includes time information
      const startAtStr = scheduleValues.scheduleStartAt
      const hasTimeComponent =
        startAtStr.includes('T') && (startAtStr.includes(':') || startAtStr.includes('.'))

      if (hasTimeComponent) {
        // If the string already has time info, parse it directly but with timezone awareness
        const startDate = new Date(startAtStr)

        // If it's a UTC ISO string (ends with Z), use it directly
        if (startAtStr.endsWith('Z') && timezone === 'UTC') {
          if (startDate > baseDate) {
            return startDate
          }
        } else {
          // For non-UTC dates or when timezone isn't UTC, we need to interpret it in the specified timezone
          // Extract time from the date string (crude but effective for ISO format)
          const timeMatch = startAtStr.match(/T(\d{2}:\d{2})/)
          const timeStr = timeMatch ? timeMatch[1] : '00:00'

          // Use our timezone-aware function with the extracted time
          const tzAwareDate = createDateWithTimezone(
            startAtStr.split('T')[0], // Just the date part
            timeStr, // Time extracted from string
            timezone
          )

          if (tzAwareDate > baseDate) {
            return tzAwareDate
          }
        }
      } else {
        // If no time component in the string, use midnight in the specified timezone
        const startDate = createDateWithTimezone(
          scheduleValues.scheduleStartAt,
          '00:00', // Use midnight in the specified timezone
          timezone
        )

        if (startDate > baseDate) {
          return startDate
        }
      }
    } catch (e) {
      logger.error('Error parsing scheduleStartAt:', e)
    }
  }

  // For recurring schedules, use Croner with timezone support
  // This ensures proper timezone handling and DST transitions
  try {
    const cronExpression = generateCronExpression(scheduleType, scheduleValues)
    logger.debug(`Using cron expression: ${cronExpression} with timezone: ${timezone}`)

    // Create Croner instance with timezone support
    const cron = new Cron(cronExpression, {
      timezone,
    })

    const nextDate = cron.nextRun()

    if (!nextDate) {
      throw new Error(`No next run date calculated for cron: ${cronExpression}`)
    }

    logger.debug(`Next run calculated: ${nextDate.toISOString()}`)
    return nextDate
  } catch (error) {
    logger.error('Error calculating next run with Croner:', error)
    throw new Error(
      `Failed to calculate next run time for schedule type ${scheduleType}: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

/**
 * Helper function to get a friendly timezone abbreviation
 */
function getTimezoneAbbreviation(timezone: string): string {
  const timezoneMap: Record<string, string> = {
    'America/Los_Angeles': 'PT',
    'America/Denver': 'MT',
    'America/Chicago': 'CT',
    'America/New_York': 'ET',
    'Europe/London': 'GMT/BST',
    'Europe/Paris': 'CET/CEST',
    'Asia/Tokyo': 'JST',
    'Asia/Singapore': 'SGT',
    'Australia/Sydney': 'AEDT/AEST',
    UTC: 'UTC',
  }

  return timezoneMap[timezone] || timezone
}

/**
 * Converts a cron expression to a human-readable string format
 * Uses the cronstrue library for accurate parsing of complex cron expressions
 *
 * @param cronExpression - The cron expression to parse
 * @param timezone - Optional IANA timezone string to include in the description
 * @returns Human-readable description of the schedule
 */
export const parseCronToHumanReadable = (cronExpression: string, timezone?: string): string => {
  try {
    // Use cronstrue for reliable cron expression parsing
    const baseDescription = cronstrue.toString(cronExpression, {
      use24HourTimeFormat: false, // Use 12-hour format with AM/PM
      verbose: false, // Keep it concise
    })

    // Add timezone information if provided and not UTC
    if (timezone && timezone !== 'UTC') {
      const tzAbbr = getTimezoneAbbreviation(timezone)
      return `${baseDescription} (${tzAbbr})`
    }

    return baseDescription
  } catch (error) {
    logger.warn('Failed to parse cron expression with cronstrue:', {
      cronExpression,
      error: error instanceof Error ? error.message : String(error),
    })
    // Fallback to displaying the raw cron expression
    return `Schedule: ${cronExpression}${timezone && timezone !== 'UTC' ? ` (${getTimezoneAbbreviation(timezone)})` : ''}`
  }
}

/**
 * Format schedule information for display
 */
export const getScheduleInfo = (
  cronExpression: string | null,
  nextRunAt: string | null,
  lastRanAt: string | null,
  scheduleType?: string | null,
  timezone?: string | null
): {
  scheduleTiming: string
  nextRunFormatted: string | null
  lastRunFormatted: string | null
} => {
  if (!nextRunAt) {
    return {
      scheduleTiming: 'Unknown schedule',
      nextRunFormatted: null,
      lastRunFormatted: null,
    }
  }

  let scheduleTiming = 'Unknown schedule'

  if (cronExpression) {
    // Pass timezone to parseCronToHumanReadable for accurate display
    scheduleTiming = parseCronToHumanReadable(cronExpression, timezone || undefined)
  } else if (scheduleType) {
    scheduleTiming = `${scheduleType.charAt(0).toUpperCase() + scheduleType.slice(1)}`
  }

  return {
    scheduleTiming,
    nextRunFormatted: formatDateTime(new Date(nextRunAt)),
    lastRunFormatted: lastRanAt ? formatDateTime(new Date(lastRanAt)) : null,
  }
}
