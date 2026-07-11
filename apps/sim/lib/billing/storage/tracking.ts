/**
 * Storage usage tracking
 * Updates storage_used_bytes for users and organizations
 * Only tracks when billing is enabled
 */

import { db } from '@sim/db'
import { organization, userStats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { isRecordLike } from '@sim/utils/object'
import { eq, sql } from 'drizzle-orm'
import { maybeNotifyLimit } from '@/lib/billing/core/limit-notifications'
import type { HighestPrioritySubscription } from '@/lib/billing/core/plan'
import type { BillingEntity } from '@/lib/billing/core/usage-log'
import type { StorageBillingContext } from '@/lib/billing/storage/context'
import { getLegacyStorageBillingEntity } from '@/lib/billing/storage/entity'
import {
  getStorageLimitForBillingContext,
  getStorageUsageForBillingContext,
  getUserStorageLimit,
  getUserStorageUsage,
} from '@/lib/billing/storage/limits'
import { isBillingEnabled } from '@/lib/core/config/env-flags'
import type { DbOrTx } from '@/lib/db/types'

const logger = createLogger('StorageTracking')

type StorageCounterMutation = 'increment' | 'decrement'

/** Format bytes as a `GB` label for usage-limit emails (2dp usage, whole-number limit). */
function formatGb(bytes: number, decimals: number): string {
  return `${(bytes / 1024 ** 3).toFixed(decimals)} GB`
}

/**
 * Reads the updated counter from a PostgreSQL `RETURNING` result.
 */
function readReturnedStorageUsage(value: unknown): number | undefined {
  if (!Array.isArray(value) || value.length === 0 || !isRecordLike(value[0])) return undefined
  const storageUsedBytes = value[0].storageUsedBytes
  return typeof storageUsedBytes === 'number' && Number.isFinite(storageUsedBytes)
    ? storageUsedBytes
    : undefined
}

/**
 * Atomically mutates one user or organization storage counter and returns the
 * updated value when PostgreSQL reports the matching row.
 */
async function mutateStorageUsage(
  executor: DbOrTx,
  billingEntity: Readonly<BillingEntity>,
  bytes: number,
  mutation: StorageCounterMutation
): Promise<number | undefined> {
  if (billingEntity.type === 'organization') {
    const storageUsedBytes =
      mutation === 'increment'
        ? sql`${organization.storageUsedBytes} + ${bytes}`
        : sql`GREATEST(0, ${organization.storageUsedBytes} - ${bytes})`
    const returned: unknown = await executor
      .update(organization)
      .set({ storageUsedBytes })
      .where(eq(organization.id, billingEntity.id))
      .returning({ storageUsedBytes: organization.storageUsedBytes })
    return readReturnedStorageUsage(returned)
  }

  const storageUsedBytes =
    mutation === 'increment'
      ? sql`${userStats.storageUsedBytes} + ${bytes}`
      : sql`GREATEST(0, ${userStats.storageUsedBytes} - ${bytes})`
  const returned: unknown = await executor
    .update(userStats)
    .set({ storageUsedBytes })
    .where(eq(userStats.userId, billingEntity.id))
    .returning({ storageUsedBytes: userStats.storageUsedBytes })
  return readReturnedStorageUsage(returned)
}

/**
 * Best-effort storage threshold evaluation after a usage change. Uses the
 * mutation's returned usage when available, then delegates dedup + send to
 * {@link maybeNotifyLimit}. Never throws.
 *
 * The caller passes the subscription it already resolved for the increment/
 * decrement, so the whole path (usage read, limit, scope) reuses a single
 * `getHighestPrioritySubscription` instead of re-fetching it three times.
 *
 * @param updatedUsage - Updated counter returned by PostgreSQL. Missing rows
 *   fall back to the legacy usage read.
 * @param rearmOnly - True on decrements, so a shrink that leaves usage above a
 *   threshold re-arms but never sends (a drop is not a fresh crossing).
 */
async function maybeNotifyStorageLimit(
  userId: string,
  workspaceId: string,
  sub: HighestPrioritySubscription | null,
  updatedUsage?: number,
  rearmOnly = false
): Promise<void> {
  try {
    const [usage, limit] = await Promise.all([
      updatedUsage === undefined ? getUserStorageUsage(userId, sub) : Promise.resolve(updatedUsage),
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
 * Evaluates storage notifications against the same immutable payer used for
 * the counter mutation.
 */
async function maybeNotifyStorageLimitForBillingContext(
  context: StorageBillingContext,
  updatedUsage?: number,
  rearmOnly = false
): Promise<void> {
  try {
    const [usage, limit] = await Promise.all([
      updatedUsage === undefined
        ? getStorageUsageForBillingContext(context)
        : Promise.resolve(updatedUsage),
      Promise.resolve(getStorageLimitForBillingContext(context)),
    ])

    await maybeNotifyLimit({
      category: 'storage',
      billedUserId: context.billedAccountUserId,
      billingEntity: context.billingEntity,
      workspaceId: context.workspaceId,
      currentUsage: usage,
      limit,
      usageLabel: formatGb(usage, 2),
      limitLabel: formatGb(limit, 0),
      rearmOnly,
    })
  } catch (error) {
    logger.error('Error evaluating workspace payer storage notification:', error)
  }
}

/**
 * Increments the exact workspace payer's storage counter.
 */
export async function incrementStorageUsageForBillingContext(
  context: StorageBillingContext,
  bytes: number
): Promise<void> {
  if (!isBillingEnabled || bytes <= 0) return

  let updatedUsage: number | undefined
  try {
    updatedUsage = await mutateStorageUsage(db, context.billingEntity, bytes, 'increment')
  } catch (error) {
    logger.error('Error incrementing workspace payer storage usage:', error)
    throw error
  }

  void maybeNotifyStorageLimitForBillingContext(context, updatedUsage)
}

/**
 * Decrements the exact workspace payer's storage counter.
 */
export async function decrementStorageUsageForBillingContext(
  context: StorageBillingContext,
  bytes: number
): Promise<void> {
  if (!isBillingEnabled || bytes <= 0) return

  let updatedUsage: number | undefined
  try {
    updatedUsage = await mutateStorageUsage(db, context.billingEntity, bytes, 'decrement')
  } catch (error) {
    logger.error('Error decrementing workspace payer storage usage:', error)
    throw error
  }

  void maybeNotifyStorageLimitForBillingContext(context, updatedUsage, true)
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
  let updatedUsage: number | undefined
  try {
    const { getHighestPrioritySubscription } = await import('@/lib/billing/core/subscription')
    sub = await getHighestPrioritySubscription(userId)
    const billingEntity = getLegacyStorageBillingEntity(userId, sub)
    updatedUsage = await mutateStorageUsage(db, billingEntity, bytes, 'increment')

    if (billingEntity.type === 'organization') {
      logger.info(`Incremented org storage: ${bytes} bytes for org ${billingEntity.id}`)
    } else {
      logger.info(`Incremented user storage: ${bytes} bytes for user ${userId}`)
    }
  } catch (error) {
    logger.error('Error incrementing storage usage:', error)
    throw error
  }

  if (workspaceId) {
    void maybeNotifyStorageLimit(userId, workspaceId, sub, updatedUsage)
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
  let updatedUsage: number | undefined
  try {
    const { getHighestPrioritySubscription } = await import('@/lib/billing/core/subscription')
    sub = await getHighestPrioritySubscription(userId)
    const billingEntity = getLegacyStorageBillingEntity(userId, sub)
    updatedUsage = await mutateStorageUsage(db, billingEntity, bytes, 'decrement')

    if (billingEntity.type === 'organization') {
      logger.info(`Decremented org storage: ${bytes} bytes for org ${billingEntity.id}`)
    } else {
      logger.info(`Decremented user storage: ${bytes} bytes for user ${userId}`)
    }
  } catch (error) {
    logger.error('Error decrementing storage usage:', error)
    throw error
  }

  if (workspaceId) {
    void maybeNotifyStorageLimit(userId, workspaceId, sub, updatedUsage, true)
  }
}

/**
 * Decrement a user's (or their org's) storage counter inside an existing
 * transaction, using a pre-resolved subscription. This lets a caller make the
 * counter update atomic with the DB rows it is deleting (e.g. hard-deleting
 * documents), so a failure of either rolls back both — no inflated counter, no
 * over-decrement. The caller resolves the subscription (a read) before opening
 * the transaction.
 */
export async function decrementStorageUsageInTx(
  tx: DbOrTx,
  sub: HighestPrioritySubscription | null,
  userId: string,
  bytes: number
): Promise<void> {
  if (!isBillingEnabled || bytes <= 0) return
  await mutateStorageUsage(tx, getLegacyStorageBillingEntity(userId, sub), bytes, 'decrement')
}

/**
 * Decrements the exact workspace payer's storage counter inside an existing
 * transaction.
 */
export async function decrementStorageUsageForBillingContextInTx(
  tx: DbOrTx,
  context: StorageBillingContext,
  bytes: number
): Promise<void> {
  if (!isBillingEnabled || bytes <= 0) return
  await mutateStorageUsage(tx, context.billingEntity, bytes, 'decrement')
}
