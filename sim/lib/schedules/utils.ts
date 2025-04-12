import { formatDateTime } from '@/lib/utils'

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
  return [
    isNaN(hours) ? 9 : hours, 
    isNaN(minutes) ? 0 : minutes
  ]
}

/**
 * Get time values from starter block for scheduling
 * @param starterBlock - The starter block containing schedule configuration
 * @returns Object with parsed time values
 */
export function getScheduleTimeValues(starterBlock: BlockState): {
  scheduleTime: string
  minutesInterval: number
  hourlyMinute: number
  dailyTime: [number, number]
  weeklyDay: number
  weeklyTime: [number, number]
  monthlyDay: number
  monthlyTime: [number, number]
} {
  // Extract schedule time (common field that can override others)
  const scheduleTime = getSubBlockValue(starterBlock, 'scheduleTime')
  
  // Get minutes interval (default to 15)
  const minutesIntervalStr = getSubBlockValue(starterBlock, 'minutesInterval')
  const minutesInterval = parseInt(minutesIntervalStr) || 15
  
  // Get hourly minute (default to 0)
  const hourlyMinuteStr = getSubBlockValue(starterBlock, 'hourlyMinute')
  const hourlyMinute = parseInt(hourlyMinuteStr) || 0
  
  // Get daily time
  const dailyTime = parseTimeString(getSubBlockValue(starterBlock, 'dailyTime'))
  
  // Get weekly config
  const weeklyDayStr = getSubBlockValue(starterBlock, 'weeklyDay') || 'MON'
  const weeklyDay = DAY_MAP[weeklyDayStr] || 1
  const weeklyTime = parseTimeString(getSubBlockValue(starterBlock, 'weeklyDayTime'))
  
  // Get monthly config
  const monthlyDayStr = getSubBlockValue(starterBlock, 'monthlyDay')
  const monthlyDay = parseInt(monthlyDayStr) || 1
  const monthlyTime = parseTimeString(getSubBlockValue(starterBlock, 'monthlyTime'))
  
  return {
    scheduleTime,
    minutesInterval,
    hourlyMinute,
    dailyTime,
    weeklyDay,
    weeklyTime,
    monthlyDay,
    monthlyTime
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
      const cronExpression = getSubBlockValue(scheduleValues as any, 'cronExpression')
      if (!cronExpression) {
        throw new Error('No cron expression provided for custom schedule')
      }
      return cronExpression
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
  // Always prioritize scheduleTime if it's set
  const scheduleTimeOverride = scheduleValues.scheduleTime 
    ? parseTimeString(scheduleValues.scheduleTime) 
    : null
  
  // Start with current date/time
  const nextRun = new Date()
  
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
      
      // If we're past this time, add another interval
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
      
      // If we're in the past, move to next hour
      if (nextRun <= new Date()) {
        nextRun.setHours(nextRun.getHours() + 1)
      }
      return nextRun
    }
    
    case 'daily': {
      // Use either schedule override or daily time values
      const [hours, minutes] = scheduleTimeOverride || scheduleValues.dailyTime
      
      nextRun.setHours(hours, minutes, 0, 0)
      
      // If we're in the past, move to tomorrow
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
      
      // If we're in the past, move to next month
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
    const minute = parseInt(parts[0], 10)
    const hour = parseInt(parts[1], 10)
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
    const minute = parseInt(parts[0], 10)
    const hour = parseInt(parts[1], 10)
    const dayOfWeek = parseInt(parts[4], 10)
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    const day = days[dayOfWeek % 7]
    const period = hour >= 12 ? 'PM' : 'AM'
    const hour12 = hour % 12 || 12
    return `Every ${day} at ${hour12}:${minute.toString().padStart(2, '0')} ${period}`
  }

  // Specific day of month at specific time
  if (cronExpression.match(/^\d+ \d+ \d+ \* \*$/)) {
    const minute = parseInt(parts[0], 10)
    const hour = parseInt(parts[1], 10)
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
    const minute = parseInt(parts[0], 10)
    const hour = parseInt(parts[1], 10)
    const dayOfWeek = parseInt(parts[4], 10)
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
      const hourVal = parseInt(hour, 10)
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
        const monthNames = month.split(',').map((m) => months[parseInt(m, 10) - 1])
        description += `on day ${dayOfMonth} of ${monthNames.join(', ')}`
      } else {
        description += `on day ${dayOfMonth} of ${months[parseInt(month, 10) - 1]}`
      }
    } else if (dayOfWeek !== '*') {
      const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
      if (dayOfWeek.includes(',')) {
        const dayNames = dayOfWeek.split(',').map((d) => days[parseInt(d, 10) % 7])
        description += `on ${dayNames.join(', ')}`
      } else if (dayOfWeek.includes('-')) {
        const [start, end] = dayOfWeek.split('-').map((d) => parseInt(d, 10) % 7)
        description += `from ${days[start]} to ${days[end]}`
      } else {
        description += `on ${days[parseInt(dayOfWeek, 10) % 7]}`
      }
    }

    return description.trim()
  } catch (e) {
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
