/**
 * Storage limit management
 * Similar to cost limits but for file storage quotas
 */

import { db } from '@sim/db'
import {
  DEFAULT_ENTERPRISE_STORAGE_LIMIT_GB,
  DEFAULT_FREE_STORAGE_LIMIT_GB,
  DEFAULT_PRO_STORAGE_LIMIT_GB,
  DEFAULT_TEAM_STORAGE_LIMIT_GB,
} from '@sim/db/constants'
import { organization, userStats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import type { HighestPrioritySubscription } from '@/lib/billing/core/plan'
import { getPlanTypeForLimits, isEnterprise, isFree } from '@/lib/billing/plan-helpers'
import { isOrgScopedSubscription } from '@/lib/billing/subscriptions/utils'
import { getEnv } from '@/lib/core/config/env'
import { isBillingEnabled } from '@/lib/core/config/env-flags'

const logger = createLogger('StorageLimits')

/** Resolve the highest-priority subscription via a deferred import (avoids a static cycle). */
async function resolveSub(userId: string): Promise<HighestPrioritySubscription | null> {
  const { getHighestPrioritySubscription } = await import('@/lib/billing/core/subscription')
  return getHighestPrioritySubscription(userId)
}

/**
 * Convert GB to bytes
 */
function gbToBytes(gb: number): number {
  return gb * 1024 * 1024 * 1024
}

/**
 * Get storage limits from environment variables with fallback to constants
 * Returns limits in bytes
 */
export function getStorageLimits() {
  return {
    free: gbToBytes(
      Number.parseInt(getEnv('FREE_STORAGE_LIMIT_GB') || String(DEFAULT_FREE_STORAGE_LIMIT_GB))
    ),
    pro: gbToBytes(
      Number.parseInt(getEnv('PRO_STORAGE_LIMIT_GB') || String(DEFAULT_PRO_STORAGE_LIMIT_GB))
    ),
    team: gbToBytes(
      Number.parseInt(getEnv('TEAM_STORAGE_LIMIT_GB') || String(DEFAULT_TEAM_STORAGE_LIMIT_GB))
    ),
    enterpriseDefault: gbToBytes(
      Number.parseInt(
        getEnv('ENTERPRISE_STORAGE_LIMIT_GB') || String(DEFAULT_ENTERPRISE_STORAGE_LIMIT_GB)
      )
    ),
  }
}

/**
 * Get storage limit for a specific plan
 * Returns limit in bytes
 */
export function getStorageLimitForPlan(plan: string, metadata?: any): number {
  const limits = getStorageLimits()

  if (isEnterprise(plan)) {
    if (metadata?.storageLimitGB) {
      return gbToBytes(Number.parseInt(metadata.storageLimitGB))
    }
    return limits.enterpriseDefault
  }

  const effectivePlan = getPlanTypeForLimits(plan)
  const limitByPlan: Record<'free' | 'pro' | 'team', number> = {
    free: limits.free,
    pro: limits.pro,
    team: limits.team,
  }
  return limitByPlan[effectivePlan as 'free' | 'pro' | 'team'] ?? limits.free
}

/**
 * Get storage limit for a user based on their subscription. Returns limit in
 * bytes.
 *
 * @param prefetchedSub - Pass an already-resolved subscription (may be `null`)
 *   to skip the `getHighestPrioritySubscription` lookup on hot paths. Omit
 *   (leave `undefined`) to fetch it here.
 */
export async function getUserStorageLimit(
  userId: string,
  prefetchedSub?: HighestPrioritySubscription | null
): Promise<number> {
  try {
    const sub = prefetchedSub === undefined ? await resolveSub(userId) : prefetchedSub

    const limits = getStorageLimits()

    if (!sub || isFree(sub.plan)) {
      return limits.free
    }

    // Org-scoped subs use pooled org-level storage. Custom limits come from the
    // subscription metadata (already on `sub`); otherwise team/enterprise default.
    if (isOrgScopedSubscription(sub, userId)) {
      const metadata = sub.metadata as { customStorageLimitGB?: number } | null
      if (metadata?.customStorageLimitGB) {
        return metadata.customStorageLimitGB * 1024 * 1024 * 1024
      }
      return isEnterprise(sub.plan) ? limits.enterpriseDefault : limits.team
    }

    // Personally-scoped plans use the per-plan default storage cap.
    const effectivePlan = getPlanTypeForLimits(sub.plan)
    const limitByPlan: Record<'free' | 'pro' | 'team', number> = {
      free: limits.free,
      pro: limits.pro,
      team: limits.team,
    }
    return limitByPlan[effectivePlan as 'free' | 'pro' | 'team'] ?? limits.free
  } catch (error) {
    logger.error('Error getting user storage limit:', error)
    return getStorageLimits().free
  }
}

/**
 * Get current storage usage for a user. Returns usage in bytes.
 *
 * @param prefetchedSub - Pass an already-resolved subscription (may be `null`)
 *   to skip the `getHighestPrioritySubscription` lookup on hot paths.
 */
export async function getUserStorageUsage(
  userId: string,
  prefetchedSub?: HighestPrioritySubscription | null
): Promise<number> {
  try {
    const sub = prefetchedSub === undefined ? await resolveSub(userId) : prefetchedSub

    // Org-scoped subs share pooled `organization.storageUsedBytes`;
    // personal plans use `userStats`.
    if (isOrgScopedSubscription(sub, userId) && sub) {
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
 * Always allows uploads when billing is disabled
 */
export async function checkStorageQuota(
  userId: string,
  additionalBytes: number
): Promise<{ allowed: boolean; currentUsage: number; limit: number; error?: string }> {
  if (!isBillingEnabled) {
    return {
      allowed: true,
      currentUsage: 0,
      limit: Number.MAX_SAFE_INTEGER,
    }
  }

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
