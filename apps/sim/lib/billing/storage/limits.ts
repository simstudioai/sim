/**
 * Storage limit management
 * Similar to cost limits but for file storage quotas
 */

import { db } from '@sim/db'
import { organization, subscription, userStats } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('StorageLimits')

/**
 * Convert GB to bytes
 */
function gbToBytes(gb: number): number {
  return gb * 1024 * 1024 * 1024
}

/**
 * Get storage limits from environment variables
 * Returns limits in bytes
 * Defaults are defined in env.ts and will be applied automatically
 */
export function getStorageLimits() {
  return {
    free: gbToBytes(env.FREE_STORAGE_LIMIT_GB),
    pro: gbToBytes(env.PRO_STORAGE_LIMIT_GB),
    team: gbToBytes(env.TEAM_STORAGE_LIMIT_GB),
    enterpriseDefault: gbToBytes(env.ENTERPRISE_STORAGE_LIMIT_GB),
  }
}

/**
 * Get storage limit for a specific plan
 * Returns limit in bytes
 */
export function getStorageLimitForPlan(plan: string, metadata?: any): number {
  const limits = getStorageLimits()

  switch (plan) {
    case 'free':
      return limits.free
    case 'pro':
      return limits.pro
    case 'team':
      return limits.team
    case 'enterprise':
      // Check for custom limit in metadata (stored in GB)
      if (metadata?.storageLimitGB) {
        return gbToBytes(Number.parseInt(metadata.storageLimitGB))
      }
      return limits.enterpriseDefault
    default:
      return limits.free
  }
}

/**
 * Get storage limit for a user based on their subscription
 * Returns limit in bytes
 */
export async function getUserStorageLimit(userId: string): Promise<number> {
  try {
    const { getHighestPrioritySubscription } = await import('@/lib/billing/core/subscription')
    const sub = await getHighestPrioritySubscription(userId)

    const limits = getStorageLimits()

    if (!sub || sub.plan === 'free') {
      return limits.free
    }

    if (sub.plan === 'pro') {
      return limits.pro
    }

    if (sub.plan === 'team' || sub.plan === 'enterprise') {
      const orgRecord = await db
        .select({ metadata: subscription.metadata })
        .from(subscription)
        .where(eq(subscription.id, sub.id))
        .limit(1)

      if (orgRecord.length > 0 && orgRecord[0].metadata) {
        const metadata = orgRecord[0].metadata as any
        if (metadata.customStorageLimitGB) {
          return metadata.customStorageLimitGB * 1024 * 1024 * 1024
        }
      }

      return sub.plan === 'enterprise' ? limits.enterpriseDefault : limits.team
    }

    return limits.free
  } catch (error) {
    logger.error('Error getting user storage limit:', error)
    return getStorageLimits().free
  }
}

/**
 * Get current storage usage for a user
 * Returns usage in bytes
 */
export async function getUserStorageUsage(userId: string): Promise<number> {
  try {
    const { getHighestPrioritySubscription } = await import('@/lib/billing/core/subscription')
    const sub = await getHighestPrioritySubscription(userId)

    if (sub && (sub.plan === 'team' || sub.plan === 'enterprise')) {
      const orgRecord = await db
        .select({ storageUsedBytes: organization.storageUsedBytes })
        .from(organization)
        .where(eq(organization.id, sub.referenceId))
        .limit(1)

      return orgRecord.length > 0 ? orgRecord[0].storageUsedBytes || 0 : 0
    }

    const stats = await db
      .select({ storageUsedBytes: userStats.storageUsedBytes })
      .from(userStats)
      .where(eq(userStats.userId, userId))
      .limit(1)

    return stats.length > 0 ? stats[0].storageUsedBytes || 0 : 0
  } catch (error) {
    logger.error('Error getting user storage usage:', error)
    return 0
  }
}

/**
 * Check if user has storage quota available
 */
export async function checkStorageQuota(
  userId: string,
  additionalBytes: number
): Promise<{ allowed: boolean; currentUsage: number; limit: number; error?: string }> {
  try {
    const [currentUsage, limit] = await Promise.all([
      getUserStorageUsage(userId),
      getUserStorageLimit(userId),
    ])

    const newUsage = currentUsage + additionalBytes
    const allowed = newUsage <= limit

    return {
      allowed,
      currentUsage,
      limit,
      error: allowed
        ? undefined
        : `Storage limit exceeded. Used: ${(newUsage / (1024 * 1024 * 1024)).toFixed(2)}GB, Limit: ${(limit / (1024 * 1024 * 1024)).toFixed(0)}GB`,
    }
  } catch (error) {
    logger.error('Error checking storage quota:', error)
    return {
      allowed: false,
      currentUsage: 0,
      limit: 0,
      error: 'Failed to check storage quota',
    }
  }
}
