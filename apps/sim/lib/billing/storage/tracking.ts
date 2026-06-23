/**
 * Storage usage tracking
 * Updates storage_used_bytes for users and organizations
 * Only tracks when billing is enabled
 */

import { db } from '@sim/db'
import { organization, userStats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq, sql } from 'drizzle-orm'
import { maybeNotifyLimit } from '@/lib/billing/core/limit-notifications'
import { getUserStorageLimit, getUserStorageUsage } from '@/lib/billing/storage/limits'
import { isOrgScopedSubscription } from '@/lib/billing/subscriptions/utils'
import { isBillingEnabled } from '@/lib/core/config/env-flags'

const logger = createLogger('StorageTracking')

/** Format bytes as a `GB` label for usage-limit emails (2dp usage, whole-number limit). */
function formatGb(bytes: number, decimals: number): string {
  return `${(bytes / 1024 ** 3).toFixed(decimals)} GB`
}

/**
 * Best-effort storage threshold evaluation after a usage change. Re-reads the
 * (now updated) usage and plan limit, then delegates scope resolution + dedup +
 * send to {@link maybeNotifyLimit}. Never throws.
 *
 * @param rearmOnly - True on decrements, so a shrink that leaves usage above a
 *   threshold re-arms but never sends (a drop is not a fresh crossing).
 */
async function maybeNotifyStorageLimit(
  userId: string,
  workspaceId: string,
  rearmOnly = false
): Promise<void> {
  try {
    const [usage, limit] = await Promise.all([
      getUserStorageUsage(userId),
      getUserStorageLimit(userId),
    ])

    await maybeNotifyLimit({
      category: 'storage',
      billedUserId: userId,
      workspaceId,
      currentUsage: usage,
      limit,
      usageLabel: formatGb(usage, 2),
      limitLabel: formatGb(limit, 0),
      rearmOnly,
    })
  } catch (error) {
    logger.error('Error evaluating storage limit notification:', error)
  }
}

/**
 * Increment storage usage after successful file upload
 * Only tracks if billing is enabled
 *
 * @param workspaceId - When provided, evaluates the storage usage-limit email
 *   (80% / 100%) after the increment. Best-effort; never blocks the upload.
 */
export async function incrementStorageUsage(
  userId: string,
  bytes: number,
  workspaceId?: string
): Promise<void> {
  if (!isBillingEnabled) {
    logger.debug('Billing disabled, skipping storage increment')
    return
  }

  try {
    const { getHighestPrioritySubscription } = await import('@/lib/billing/core/subscription')
    const sub = await getHighestPrioritySubscription(userId)

    // Org-scoped subs pool at the org level; personal plans per-user.
    if (isOrgScopedSubscription(sub, userId) && sub) {
      await db
        .update(organization)
        .set({
          storageUsedBytes: sql`${organization.storageUsedBytes} + ${bytes}`,
        })
        .where(eq(organization.id, sub.referenceId))

      logger.info(`Incremented org storage: ${bytes} bytes for org ${sub.referenceId}`)
    } else {
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

  if (workspaceId) {
    void maybeNotifyStorageLimit(userId, workspaceId)
  }
}

/**
 * Decrement storage usage after file deletion
 * Only tracks if billing is enabled
 *
 * @param workspaceId - When provided, re-evaluates the storage threshold state
 *   after the decrement. Usage only drops here, so this can only re-arm a
 *   previously-sent threshold (it never sends), keeping the re-warning correct
 *   after a shrink. Best-effort; never blocks the caller.
 */
export async function decrementStorageUsage(
  userId: string,
  bytes: number,
  workspaceId?: string
): Promise<void> {
  if (!isBillingEnabled) {
    logger.debug('Billing disabled, skipping storage decrement')
    return
  }

  try {
    const { getHighestPrioritySubscription } = await import('@/lib/billing/core/subscription')
    const sub = await getHighestPrioritySubscription(userId)

    if (isOrgScopedSubscription(sub, userId) && sub) {
      await db
        .update(organization)
        .set({
          storageUsedBytes: sql`GREATEST(0, ${organization.storageUsedBytes} - ${bytes})`,
        })
        .where(eq(organization.id, sub.referenceId))

      logger.info(`Decremented org storage: ${bytes} bytes for org ${sub.referenceId}`)
    } else {
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

  if (workspaceId) {
    void maybeNotifyStorageLimit(userId, workspaceId, true)
  }
}
