/**
 * Storage usage tracking
 * Updates storage_used_bytes for users and organizations
 * Only tracks when billing is enabled
 */

import { db } from '@sim/db'
import { organization, userStats, workspaceFiles } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { maybeNotifyLimit } from '@/lib/billing/core/limit-notifications'
import type { HighestPrioritySubscription } from '@/lib/billing/core/plan'
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
 * (now updated) usage and plan limit, then delegates dedup + send to
 * {@link maybeNotifyLimit}. Never throws.
 *
 * The caller passes the subscription it already resolved for the increment/
 * decrement, so the whole path (usage read, limit, scope) reuses a single
 * `getHighestPrioritySubscription` instead of re-fetching it three times.
 *
 * @param rearmOnly - True on decrements, so a shrink that leaves usage above a
 *   threshold re-arms but never sends (a drop is not a fresh crossing).
 */
async function maybeNotifyStorageLimit(
  userId: string,
  workspaceId: string,
  sub: HighestPrioritySubscription | null,
  rearmOnly = false
): Promise<void> {
  try {
    const [usage, limit] = await Promise.all([
      getUserStorageUsage(userId, sub),
      getUserStorageLimit(userId, sub),
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
      subscription: sub,
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

  let sub: HighestPrioritySubscription | null = null
  try {
    const { getHighestPrioritySubscription } = await import('@/lib/billing/core/subscription')
    sub = await getHighestPrioritySubscription(userId)

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
    void maybeNotifyStorageLimit(userId, workspaceId, sub)
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

  let sub: HighestPrioritySubscription | null = null
  try {
    const { getHighestPrioritySubscription } = await import('@/lib/billing/core/subscription')
    sub = await getHighestPrioritySubscription(userId)

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
    void maybeNotifyStorageLimit(userId, workspaceId, sub, true)
  }
}

type StorageTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * Decrement a user's (or their org's) storage counter inside an existing
 * transaction, using a pre-resolved subscription. This lets a caller make the
 * counter update atomic with the DB rows it is deleting (e.g. hard-deleting
 * documents), so a failure of either rolls back both — no inflated counter, no
 * over-decrement. The caller resolves the subscription (a read) before opening
 * the transaction.
 */
export async function decrementStorageUsageInTx(
  tx: StorageTransaction,
  sub: HighestPrioritySubscription | null,
  userId: string,
  bytes: number
): Promise<void> {
  if (!isBillingEnabled || bytes <= 0) return
  if (isOrgScopedSubscription(sub, userId) && sub) {
    await tx
      .update(organization)
      .set({ storageUsedBytes: sql`GREATEST(0, ${organization.storageUsedBytes} - ${bytes})` })
      .where(eq(organization.id, sub.referenceId))
  } else {
    await tx
      .update(userStats)
      .set({ storageUsedBytes: sql`GREATEST(0, ${userStats.storageUsedBytes} - ${bytes})` })
      .where(eq(userStats.userId, userId))
  }
}

/**
 * Atomically soft-delete a file's metadata row and decrement the owner's storage
 * counter in a single transaction.
 *
 * The soft-delete (`deletedAt` transition) is the idempotency claim: only the
 * call that actually flips the row decrements, so a retry that finds the row
 * already deleted does not double-count. Because the claim and the decrement
 * share one transaction, a failure of either rolls both back — the counter is
 * never left permanently inflated and never double-decremented. Best-effort:
 * when billing is disabled it just soft-deletes the row.
 */
export async function releaseDeletedFileStorage(
  key: string,
  userId: string,
  bytes: number,
  workspaceId?: string
): Promise<void> {
  if (!isBillingEnabled || bytes <= 0) {
    await db
      .update(workspaceFiles)
      .set({ deletedAt: new Date() })
      .where(and(eq(workspaceFiles.key, key), isNull(workspaceFiles.deletedAt)))
    return
  }

  const { getHighestPrioritySubscription } = await import('@/lib/billing/core/subscription')
  const sub = await getHighestPrioritySubscription(userId)

  let claimed = false
  await db.transaction(async (tx) => {
    const claimedRows = await tx
      .update(workspaceFiles)
      .set({ deletedAt: new Date() })
      .where(and(eq(workspaceFiles.key, key), isNull(workspaceFiles.deletedAt)))
      .returning({ id: workspaceFiles.id })
    if (claimedRows.length === 0) return
    claimed = true
    await decrementStorageUsageInTx(tx, sub, userId, bytes)
  })

  if (claimed && workspaceId) {
    void maybeNotifyStorageLimit(userId, workspaceId, sub, true)
  }
}
