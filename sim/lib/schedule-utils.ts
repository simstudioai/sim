import { formatDateTime } from '@/lib/utils'

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
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December',
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
  scheduleTiming: string;
  nextRunFormatted: string | null;
  lastRunFormatted: string | null;
} => {
  if (!nextRunAt) {
    return {
      scheduleTiming: 'Unknown schedule',
      nextRunFormatted: null,
      lastRunFormatted: null
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
    lastRunFormatted: lastRanAt ? formatDateTime(new Date(lastRanAt)) : null
  }
} 