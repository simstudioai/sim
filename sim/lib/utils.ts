import { type ClassValue, clsx } from 'clsx'
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'
import { nanoid } from 'nanoid'
import { twMerge } from 'tailwind-merge'
import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('Utils')

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

function getEncryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY
  if (!key || key.length !== 64) {
    throw new Error('ENCRYPTION_KEY must be set to a 64-character hex string (32 bytes)')
  }
  return Buffer.from(key, 'hex')
}

/**
 * Encrypts a secret using AES-256-GCM
 * @param secret - The secret to encrypt
 * @returns A promise that resolves to an object containing the encrypted secret and IV
 */
export async function encryptSecret(secret: string): Promise<{ encrypted: string; iv: string }> {
  const iv = randomBytes(16)
  const key = getEncryptionKey()

  const cipher = createCipheriv('aes-256-gcm', key, iv)
  let encrypted = cipher.update(secret, 'utf8', 'hex')
  encrypted += cipher.final('hex')

  const authTag = cipher.getAuthTag()

  // Format: iv:encrypted:authTag
  return {
    encrypted: `${iv.toString('hex')}:${encrypted}:${authTag.toString('hex')}`,
    iv: iv.toString('hex'),
  }
}

/**
 * Decrypts an encrypted secret
 * @param encryptedValue - The encrypted value in format "iv:encrypted:authTag"
 * @returns A promise that resolves to an object containing the decrypted secret
 */
export async function decryptSecret(encryptedValue: string): Promise<{ decrypted: string }> {
  const parts = encryptedValue.split(':')
  const ivHex = parts[0]
  const authTagHex = parts[parts.length - 1]
  const encrypted = parts.slice(1, -1).join(':')

  if (!ivHex || !encrypted || !authTagHex) {
    throw new Error('Invalid encrypted value format. Expected "iv:encrypted:authTag"')
  }

  const key = getEncryptionKey()
  const iv = Buffer.from(ivHex, 'hex')
  const authTag = Buffer.from(authTagHex, 'hex')

  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(authTag)

    let decrypted = decipher.update(encrypted, 'hex', 'utf8')
    decrypted += decipher.final('utf8')

    return { decrypted }
  } catch (error: any) {
    logger.error('Decryption error:', { error: error.message })
    throw error
  }
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
    case 'weekly': {
      // Expected weeklyDay as MON, TUE, etc. and weeklyDayTime in HH:MM
      const dayMap: Record<string, number> = {
        MON: 1,
        TUE: 2,
        WED: 3,
        THU: 4,
        FRI: 5,
        SAT: 6,
        SUN: 0,
      }
      const day = dayMap[options.weeklyDay || 'MON']
      const [minute, hour] = (options.weeklyDayTime || '00:09').split(':')
      return `${minute || '00'} ${hour || '09'} * * ${day}`
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

/**
 * Format a date into a human-readable format
 * @param date - The date to format
 * @returns A formatted date string in the format "MMM D, YYYY h:mm A"
 */
export function formatDateTime(date: Date): string {
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

/**
 * Format a date into a short format
 * @param date - The date to format
 * @returns A formatted date string in the format "MMM D, YYYY"
 */
export function formatDate(date: Date): string {
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
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
 * Format a duration in milliseconds to a human-readable format
 * @param durationMs - The duration in milliseconds
 * @returns A formatted duration string
 */
export function formatDuration(durationMs: number): string {
  if (durationMs < 1000) {
    return `${durationMs}ms`
  }

  const seconds = Math.floor(durationMs / 1000)
  if (seconds < 60) {
    return `${seconds}s`
  }

  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  if (minutes < 60) {
    return `${minutes}m ${remainingSeconds}s`
  }

  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return `${hours}h ${remainingMinutes}m`
}

/**
 * Generates a standardized API key with the 'sim_' prefix
 * @returns A new API key string
 */
export function generateApiKey(): string {
  return `sim_${nanoid(32)}`
}
