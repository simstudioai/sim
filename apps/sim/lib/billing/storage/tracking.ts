/**
 * Storage usage tracking
 * Updates storage_used_bytes for users and organizations
 * Only tracks when billing is enabled
 */

import { db } from '@sim/db'
import { organization, userStats } from '@sim/db/schema'
import { eq, sql } from 'drizzle-orm'
import { isBillingEnabled } from '@/lib/environment'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('StorageTracking')

/**
 * Increment storage usage after successful file upload
 * Only tracks if billing is enabled
 */
export async function incrementStorageUsage(userId: string, bytes: number): Promise<void> {
  if (!isBillingEnabled) {
    logger.debug('Billing disabled, skipping storage increment')
    return
  }

  try {
    // Check if user is in a team/enterprise org
    const { getHighestPrioritySubscription } = await import('@/lib/billing/core/subscription')
    const sub = await getHighestPrioritySubscription(userId)

    if (sub && (sub.plan === 'team' || sub.plan === 'enterprise')) {
      // Update organization storage
      await db
        .update(organization)
        .set({
          storageUsedBytes: sql`${organization.storageUsedBytes} + ${bytes}`,
        })
        .where(eq(organization.id, sub.referenceId))

      logger.info(`Incremented org storage: ${bytes} bytes for org ${sub.referenceId}`)
    } else {
      // Update user stats storage
      await db
        .update(userStats)
        .set({
          storageUsedBytes: sql`${userStats.storageUsedBytes} + ${bytes}`,
        })
        .where(eq(userStats.userId, userId))

      logger.info(`Incremented user storage: ${bytes} bytes for user ${userId}`)
    }
  } catch (error) {
    logger.error('Error incrementing storage usage:', error)
    throw error
  }
}

/**
 * Decrement storage usage after file deletion
 * Only tracks if billing is enabled
 */
export async function decrementStorageUsage(userId: string, bytes: number): Promise<void> {
  if (!isBillingEnabled) {
    logger.debug('Billing disabled, skipping storage decrement')
    return
  }

  try {
    // Check if user is in a team/enterprise org
    const { getHighestPrioritySubscription } = await import('@/lib/billing/core/subscription')
    const sub = await getHighestPrioritySubscription(userId)

    if (sub && (sub.plan === 'team' || sub.plan === 'enterprise')) {
      // Update organization storage
      await db
        .update(organization)
        .set({
          storageUsedBytes: sql`GREATEST(0, ${organization.storageUsedBytes} - ${bytes})`,
        })
        .where(eq(organization.id, sub.referenceId))

      logger.info(`Decremented org storage: ${bytes} bytes for org ${sub.referenceId}`)
    } else {
      // Update user stats storage
      await db
        .update(userStats)
        .set({
          storageUsedBytes: sql`GREATEST(0, ${userStats.storageUsedBytes} - ${bytes})`,
        })
        .where(eq(userStats.userId, userId))

      logger.info(`Decremented user storage: ${bytes} bytes for user ${userId}`)
    }
  } catch (error) {
    logger.error('Error decrementing storage usage:', error)
    throw error
  }
}
