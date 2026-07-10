/**
 * Storage usage tracking
 * Updates storage_used_bytes for users and organizations
 * Only tracks when billing is enabled
 */

import { db } from '@sim/db'
import { organization, userStats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, eq, sql } from 'drizzle-orm'
import { maybeNotifyLimit } from '@/lib/billing/core/limit-notifications'
import type { HighestPrioritySubscription } from '@/lib/billing/core/plan'
import { getUserStorageLimit, getUserStorageUsage } from '@/lib/billing/storage/limits'
import { getFreeTierLimit, isOrgScopedSubscription } from '@/lib/billing/subscriptions/utils'
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
export async function maybeNotifyStorageLimit(
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
 * Atomically check quota and increment a user's (or their org's) storage
 * counter inside an existing transaction, using a pre-resolved subscription.
 * The check and the increment are a single conditional `UPDATE`, so two
 * concurrent callers can no longer both read the same pre-increment usage,
 * both pass the check, and both commit past the limit — the second caller's
 * `UPDATE` re-evaluates the WHERE clause against the first caller's already
 * -committed-within-the-same-DB-round-trip row and correctly fails. Replaces
 * the old read-then-decide-then-increment-after-commit split (`checkStorageQuota`
 * + a fire-and-forget `incrementStorageUsage` after the transaction), which left
 * a window between the read and the increment.
 *
 * On success, callers should best-effort call {@link maybeNotifyStorageLimit}
 * after the transaction commits (mirrors the existing post-increment threshold
 * check) — this helper doesn't do it itself since it runs mid-transaction.
 *
 * For a personal (non-org-scoped) `userId`, this first upserts the
 * `userStats` row on `tx` — a documented possibility for OAuth account
 * linking (see `ensureUserStatsExists` in `lib/billing/core/usage.ts`, whose
 * insert values this mirrors) — because the conditional `UPDATE` below
 * matches 0 rows, and therefore reads as "quota exceeded", if that row
 * doesn't exist yet. `ensureUserStatsExists` itself isn't reused here since
 * it writes through the standalone `db` client, which would open a second
 * pooled connection while this transaction's is held.
 */
export async function checkAndIncrementStorageUsageInTx(
  tx: StorageTransaction,
  sub: HighestPrioritySubscription | null,
  userId: string,
  bytes: number
): Promise<{ allowed: boolean; currentUsage: number; limit: number; error?: string }> {
  if (!isBillingEnabled) {
    return { allowed: true, currentUsage: 0, limit: Number.MAX_SAFE_INTEGER }
  }

  const limit = await getUserStorageLimit(userId, sub)

  if (bytes <= 0) {
    return { allowed: true, currentUsage: await getUserStorageUsage(userId, sub), limit }
  }

  const orgScoped = isOrgScopedSubscription(sub, userId) && sub

  if (!orgScoped) {
    await tx
      .insert(userStats)
      .values({
        id: generateId(),
        userId,
        currentUsageLimit: getFreeTierLimit().toString(),
        usageLimitUpdatedAt: new Date(),
      })
      .onConflictDoNothing({ target: userStats.userId })
  }

  const [updated] = orgScoped
    ? await tx
        .update(organization)
        .set({ storageUsedBytes: sql`${organization.storageUsedBytes} + ${bytes}` })
        .where(
          and(
            eq(organization.id, sub.referenceId),
            sql`${organization.storageUsedBytes} + ${bytes} <= ${limit}`
          )
        )
        .returning({ storageUsedBytes: organization.storageUsedBytes })
    : await tx
        .update(userStats)
        .set({ storageUsedBytes: sql`${userStats.storageUsedBytes} + ${bytes}` })
        .where(
          and(
            eq(userStats.userId, userId),
            sql`${userStats.storageUsedBytes} + ${bytes} <= ${limit}`
          )
        )
        .returning({ storageUsedBytes: userStats.storageUsedBytes })

  if (updated) {
    return { allowed: true, currentUsage: updated.storageUsedBytes - bytes, limit }
  }

  const currentUsage = await getUserStorageUsage(userId, sub)
  const newUsage = currentUsage + bytes
  return {
    allowed: false,
    currentUsage,
    limit,
    error: `Storage limit exceeded. Used: ${(newUsage / (1024 * 1024 * 1024)).toFixed(2)}GB, Limit: ${(limit / (1024 * 1024 * 1024)).toFixed(0)}GB`,
  }
}
