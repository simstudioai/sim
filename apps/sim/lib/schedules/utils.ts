import { Cron } from 'croner'
import { createLogger } from '@/lib/logs/console-logger'
import { formatDateTime } from '@/lib/utils'

const logger = createLogger('ScheduleUtils')

/**
 * Validates a cron expression and returns validation results
 * @param cronExpression - The cron expression to validate
 * @returns Validation result with isValid flag, error message, and next run date
 */
export function validateCronExpression(cronExpression: string): {
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
    const cron = new Cron(cronExpression)
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

  // Validate cron expression if provided
  if (cronExpression) {
    const validation = validateCronExpression(cronExpression)
    if (!validation.isValid) {
      throw new Error(`Invalid cron expression: ${validation.error}`)
    }
  }

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

  // If we have a scheduleTime (but no future scheduleStartAt), use it for today
  const scheduleTimeOverride = scheduleValues.scheduleTime
    ? parseTimeString(scheduleValues.scheduleTime)
    : null

  // Create next run date based on the current date
  const nextRun = new Date(baseDate)

  switch (scheduleType) {
    case 'minutes': {
      const { minutesInterval } = scheduleValues

      // If we have a time override, use it
      if (scheduleTimeOverride) {
        const [hours, minutes] = scheduleTimeOverride
        nextRun.setHours(hours, minutes, 0, 0)

        // Add intervals until we're in the future
        while (nextRun <= new Date()) {
          nextRun.setMinutes(nextRun.getMinutes() + minutesInterval)
        }
        return nextRun
      }

      // For subsequent runs after lastRanAt
      if (lastRanAt) {
        const baseTime = new Date(lastRanAt)
        nextRun.setTime(baseTime.getTime())
        nextRun.setMinutes(nextRun.getMinutes() + minutesInterval, 0, 0)

        // Make sure we're in the future
        while (nextRun <= new Date()) {
          nextRun.setMinutes(nextRun.getMinutes() + minutesInterval)
        }
        return nextRun
      }

      // Calculate next boundary for minutes
      const now = new Date()
      const currentMinutes = now.getMinutes()
      const nextIntervalBoundary = Math.ceil(currentMinutes / minutesInterval) * minutesInterval
      nextRun.setMinutes(nextIntervalBoundary, 0, 0)

      // If we're past this time but haven't reached baseDate, adjust
      if (nextRun <= now) {
        nextRun.setMinutes(nextRun.getMinutes() + minutesInterval)
      }

      return nextRun
    }

    case 'hourly': {
      // Use the override time if available, otherwise use hourly config
      const [targetHours, _] = scheduleTimeOverride || [nextRun.getHours(), 0]
      const targetMinutes = scheduleValues.hourlyMinute

      nextRun.setHours(targetHours, targetMinutes, 0, 0)

      // If we're in the past relative to now (not baseDate), move to next hour
      if (nextRun <= new Date()) {
        nextRun.setHours(nextRun.getHours() + 1)
      }

      return nextRun
    }

    case 'daily': {
      // Use either schedule override or daily time values
      const [hours, minutes] = scheduleTimeOverride || scheduleValues.dailyTime

      nextRun.setHours(hours, minutes, 0, 0)

      // If we're in the past relative to now (not baseDate), move to tomorrow
      if (nextRun <= new Date()) {
        nextRun.setDate(nextRun.getDate() + 1)
      }

      return nextRun
    }

    case 'weekly': {
      // Use either schedule override or weekly time values
      const [hours, minutes] = scheduleTimeOverride || scheduleValues.weeklyTime

      nextRun.setHours(hours, minutes, 0, 0)

      // Add days until we reach the target day in the future
      while (nextRun.getDay() !== scheduleValues.weeklyDay || nextRun <= new Date()) {
        nextRun.setDate(nextRun.getDate() + 1)
      }

      return nextRun
    }

    case 'monthly': {
      // Use either schedule override or monthly time values
      const [hours, minutes] = scheduleTimeOverride || scheduleValues.monthlyTime
      const { monthlyDay } = scheduleValues

      nextRun.setDate(monthlyDay)
      nextRun.setHours(hours, minutes, 0, 0)

      // If we're in the past relative to now (not baseDate), move to next month
      if (nextRun <= new Date()) {
        nextRun.setMonth(nextRun.getMonth() + 1)
      }

      return nextRun
    }

    default:
      throw new Error(`Unsupported schedule type: ${scheduleType}`)
  }
}

/**
 * Converts a cron expression to a human-readable string format
 */
export const parseCronToHumanReadable = (cronExpression: string): string => {
  // Parse the cron parts
  const parts = cronExpression.split(' ')

  // Handle standard patterns
  if (cronExpression === '* * * * *') {
    return 'Every minute'
  }

  // Every X minutes
  if (cronExpression.match(/^\*\/\d+ \* \* \* \*$/)) {
    const minutes = cronExpression.split(' ')[0].split('/')[1]
    return `Every ${minutes} minutes`
  }

  // Daily at specific time
  if (cronExpression.match(/^\d+ \d+ \* \* \*$/)) {
    const minute = Number.parseInt(parts[0], 10)
    const hour = Number.parseInt(parts[1], 10)
    const period = hour >= 12 ? 'PM' : 'AM'
    const hour12 = hour % 12 || 12
    return `Daily at ${hour12}:${minute.toString().padStart(2, '0')} ${period}`
  }

  // Every hour at specific minute
  if (cronExpression.match(/^\d+ \* \* \* \*$/)) {
    const minute = parts[0]
    return `Hourly at ${minute} minutes past the hour`
  }

  // Specific day of week at specific time
  if (cronExpression.match(/^\d+ \d+ \* \* \d+$/)) {
    const minute = Number.parseInt(parts[0], 10)
    const hour = Number.parseInt(parts[1], 10)
    const dayOfWeek = Number.parseInt(parts[4], 10)
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    const day = days[dayOfWeek % 7]
    const period = hour >= 12 ? 'PM' : 'AM'
    const hour12 = hour % 12 || 12
    return `Every ${day} at ${hour12}:${minute.toString().padStart(2, '0')} ${period}`
  }

  // Specific day of month at specific time
  if (cronExpression.match(/^\d+ \d+ \d+ \* \*$/)) {
    const minute = Number.parseInt(parts[0], 10)
    const hour = Number.parseInt(parts[1], 10)
    const dayOfMonth = parts[2]
    const period = hour >= 12 ? 'PM' : 'AM'
    const hour12 = hour % 12 || 12
    const day =
      dayOfMonth === '1'
        ? '1st'
        : dayOfMonth === '2'
          ? '2nd'
          : dayOfMonth === '3'
            ? '3rd'
            : `${dayOfMonth}th`
    return `Monthly on the ${day} at ${hour12}:${minute.toString().padStart(2, '0')} ${period}`
  }

  // Weekly at specific time
  if (cronExpression.match(/^\d+ \d+ \* \* [0-6]$/)) {
    const minute = Number.parseInt(parts[0], 10)
    const hour = Number.parseInt(parts[1], 10)
    const dayOfWeek = Number.parseInt(parts[4], 10)
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    const day = days[dayOfWeek % 7]
    const period = hour >= 12 ? 'PM' : 'AM'
    const hour12 = hour % 12 || 12
    return `Weekly on ${day} at ${hour12}:${minute.toString().padStart(2, '0')} ${period}`
  }

  // Return a more detailed breakdown if none of the patterns match
  try {
    const [minute, hour, dayOfMonth, month, dayOfWeek] = parts
    let description = 'Runs '

    // Time component
    if (minute === '*' && hour === '*') {
      description += 'every minute '
    } else if (minute.includes('/') && hour === '*') {
      const interval = minute.split('/')[1]
      description += `every ${interval} minutes `
    } else if (minute !== '*' && hour !== '*') {
      const hourVal = Number.parseInt(hour, 10)
      const period = hourVal >= 12 ? 'PM' : 'AM'
      const hour12 = hourVal % 12 || 12
      description += `at ${hour12}:${minute.padStart(2, '0')} ${period} `
    }

    // Day component
    if (dayOfMonth !== '*' && month !== '*') {
      const months = [
        'January',
        'February',
        'March',
        'April',
        'May',
        'June',
        'July',
        'August',
        'September',
        'October',
        'November',
        'December',
      ]

      if (month.includes(',')) {
        const monthNames = month.split(',').map((m) => months[Number.parseInt(m, 10) - 1])
        description += `on day ${dayOfMonth} of ${monthNames.join(', ')}`
      } else if (month.includes('/')) {
        // Handle interval patterns like */3, 1/3, etc.
        const interval = month.split('/')[1]
        description += `on day ${dayOfMonth} every ${interval} months`
      } else if (month.includes('-')) {
        // Handle range patterns like 1-6
        const [start, end] = month.split('-').map((m) => Number.parseInt(m, 10))
        const startMonth = months[start - 1]
        const endMonth = months[end - 1]
        description += `on day ${dayOfMonth} from ${startMonth} to ${endMonth}`
      } else {
        // Handle specific month numbers
        const monthIndex = Number.parseInt(month, 10) - 1
        const monthName = months[monthIndex]
        if (monthName) {
          description += `on day ${dayOfMonth} of ${monthName}`
        } else {
          description += `on day ${dayOfMonth} of month ${month}`
        }
      }
    } else if (dayOfWeek !== '*') {
      const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
      if (dayOfWeek.includes(',')) {
        const dayNames = dayOfWeek.split(',').map((d) => days[Number.parseInt(d, 10) % 7])
        description += `on ${dayNames.join(', ')}`
      } else if (dayOfWeek.includes('-')) {
        const [start, end] = dayOfWeek.split('-').map((d) => Number.parseInt(d, 10) % 7)
        description += `from ${days[start]} to ${days[end]}`
      } else {
        description += `on ${days[Number.parseInt(dayOfWeek, 10) % 7]}`
      }
    }

    return description.trim()
  } catch (_e) {
    return `Schedule: ${cronExpression}`
  }
}

/**
 * Format schedule information for display
 */
export const getScheduleInfo = (
  cronExpression: string | null,
  nextRunAt: string | null,
  lastRanAt: string | null,
  scheduleType?: string | null
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
    scheduleTiming = parseCronToHumanReadable(cronExpression)
  } else if (scheduleType) {
    scheduleTiming = `${scheduleType.charAt(0).toUpperCase() + scheduleType.slice(1)}`
  }

  return {
    scheduleTiming,
    nextRunFormatted: formatDateTime(new Date(nextRunAt)),
    lastRunFormatted: lastRanAt ? formatDateTime(new Date(lastRanAt)) : null,
  }
}
