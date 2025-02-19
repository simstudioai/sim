import { type ClassValue, clsx } from 'clsx'
import { createHash } from 'crypto'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Hashes a secret using SHA-256 with a salt
 * @param secret - The secret to hash
 * @param salt - Optional salt to use for hashing. If not provided, a random salt will be generated
 * @returns A promise that resolves to an object containing the hashed secret and salt
 */
export async function hashSecret(
  secret: string,
  salt?: string
): Promise<{ hash: string; salt: string }> {
  const useSalt =
    salt || createHash('sha256').update(crypto.randomUUID()).digest('hex').slice(0, 16)
  const hash = createHash('sha256')
    .update(secret + useSalt)
    .digest('hex')
  return { hash, salt: useSalt }
}

export function convertScheduleOptionsToCron(
  scheduleType: string,
  options: Record<string, string>
): string {
  switch (scheduleType) {
    case 'minutes': {
      const interval = options.minutesInterval || '15'
      // For example, if options.minutesStartingAt is provided, use that as the start minute.
      return `*/${interval} * * * *`
    }
    case 'hourly': {
      // When scheduling hourly, take the specified minute offset
      return `${options.hourlyMinute || '00'} * * * *`
    }
    case 'daily': {
      // Expected dailyTime in HH:MM
      const [minute, hour] = (options.dailyTime || '00:09').split(':')
      return `${minute || '00'} ${hour || '09'} * * *`
    }
    case 'monthly': {
      // Expected monthlyDay and monthlyTime in HH:MM
      const day = options.monthlyDay || '1'
      const [minute, hour] = (options.monthlyTime || '00:09').split(':')
      return `${minute || '00'} ${hour || '09'} ${day} * *`
    }
    case 'custom': {
      // Use the provided cron expression directly
      return options.cronExpression
    }
    default:
      throw new Error('Unsupported schedule type')
  }
}
