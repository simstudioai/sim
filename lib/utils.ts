import { type ClassValue, clsx } from 'clsx'
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'
import { twMerge } from 'tailwind-merge'

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
  const [ivHex, encrypted, authTagHex] = encryptedValue.split(':')
  if (!ivHex || !encrypted || !authTagHex) {
    throw new Error('Invalid encrypted value format. Expected "iv:encrypted:authTag"')
  }

  const key = getEncryptionKey()
  const iv = Buffer.from(ivHex, 'hex')
  const authTag = Buffer.from(authTagHex, 'hex')

  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(authTag)

  let decrypted = decipher.update(encrypted, 'hex', 'utf8')
  decrypted += decipher.final('utf8')

  return { decrypted }
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
