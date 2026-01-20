import { createHash, randomBytes } from 'crypto'
import { db } from '@sim/db'
import { settings, user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { env } from '@/lib/core/config/env'
import type { EmailType } from '@/lib/messaging/email/mailer'

const logger = createLogger('Unsubscribe')

export interface EmailPreferences {
  unsubscribeAll?: boolean
  unsubscribeMarketing?: boolean
  unsubscribeUpdates?: boolean
  unsubscribeNotifications?: boolean
}

/**
 * Generate a secure unsubscribe token for an email address
 */
export function generateUnsubscribeToken(email: string, emailType = 'marketing'): string {
  const salt = randomBytes(16).toString('hex')
  const hash = createHash('sha256')
    .update(`${email}:${salt}:${emailType}:${env.BETTER_AUTH_SECRET}`)
    .digest('hex')

  return `${salt}:${hash}:${emailType}`
}

/**
 * Verify an unsubscribe token for an email address and return email type
 */
export function verifyUnsubscribeToken(
  email: string,
  token: string
): { valid: boolean; emailType?: string } {
  try {
    const parts = token.split(':')
    if (parts.length < 2) return { valid: false }

    if (parts.length === 2) {
      const [salt, expectedHash] = parts
      const hash = createHash('sha256')
        .update(`${email}:${salt}:${env.BETTER_AUTH_SECRET}`)
        .digest('hex')

      return { valid: hash === expectedHash, emailType: 'marketing' }
    }

    const [salt, expectedHash, emailType] = parts
    if (!salt || !expectedHash || !emailType) return { valid: false }

    const hash = createHash('sha256')
      .update(`${email}:${salt}:${emailType}:${env.BETTER_AUTH_SECRET}`)
      .digest('hex')

    return { valid: hash === expectedHash, emailType }
  } catch (error) {
    logger.error('Error verifying unsubscribe token:', error)
    return { valid: false }
  }
}

/**
 * Check if an email type is transactional
 */
export function isTransactionalEmail(emailType: EmailType): boolean {
  return emailType === ('transactional' as EmailType)
}

/**
 * Get user's email preferences
 */
export async function getEmailPreferences(email: string): Promise<EmailPreferences | null> {
  try {
    const result = await db
      .select({
        emailPreferences: settings.emailPreferences,
      })
      .from(user)
      .leftJoin(settings, eq(settings.userId, user.id))
      .where(eq(user.email, email))
      .limit(1)

    if (!result[0]) return null

    return (result[0].emailPreferences as EmailPreferences) || {}
  } catch (error) {
    logger.error('Error getting email preferences:', error)
    return null
  }
}

/**
 * Update user's email preferences
 */
export async function updateEmailPreferences(
  email: string,
  preferences: EmailPreferences
): Promise<boolean> {
  try {
    const userResult = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, email))
      .limit(1)

    if (!userResult[0]) {
      logger.warn(`User not found for email: ${email}`)
      return false
    }

    const userId = userResult[0].id

    const existingSettings = await db
      .select({ emailPreferences: settings.emailPreferences })
      .from(settings)
      .where(eq(settings.userId, userId))
      .limit(1)

    let currentEmailPreferences = {}
    if (existingSettings[0]) {
      currentEmailPreferences = (existingSettings[0].emailPreferences as EmailPreferences) || {}
    }

    const updatedEmailPreferences = {
      ...currentEmailPreferences,
      ...preferences,
    }

    await db
      .insert(settings)
      .values({
        id: userId,
        userId,
        emailPreferences: updatedEmailPreferences,
      })
      .onConflictDoUpdate({
        target: settings.userId,
        set: {
          emailPreferences: updatedEmailPreferences,
          updatedAt: new Date(),
        },
      })

    logger.info(`Updated email preferences for user: ${email}`)
    return true
  } catch (error) {
    logger.error('Error updating email preferences:', error)
    return false
  }
}

/**
 * Check if user has unsubscribed from a specific email type
 */
export async function isUnsubscribed(
  email: string,
  emailType: 'all' | 'marketing' | 'updates' | 'notifications' = 'all'
): Promise<boolean> {
  try {
    const preferences = await getEmailPreferences(email)
    if (!preferences) return false

    if (preferences.unsubscribeAll) return true

    switch (emailType) {
      case 'marketing':
        return preferences.unsubscribeMarketing || false
      case 'updates':
        return preferences.unsubscribeUpdates || false
      case 'notifications':
        return preferences.unsubscribeNotifications || false
      default:
        return false
    }
  } catch (error) {
    logger.error('Error checking unsubscribe status:', error)
    return false
  }
}

/**
 * Unsubscribe user from all emails
 */
export async function unsubscribeFromAll(email: string): Promise<boolean> {
  return updateEmailPreferences(email, { unsubscribeAll: true })
}

/**
 * Resubscribe user (remove all unsubscribe flags)
 */
export async function resubscribe(email: string): Promise<boolean> {
  return updateEmailPreferences(email, {
    unsubscribeAll: false,
    unsubscribeMarketing: false,
    unsubscribeUpdates: false,
    unsubscribeNotifications: false,
  })
}
