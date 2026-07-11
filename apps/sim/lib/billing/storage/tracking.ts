/**
 * Storage usage tracking
 * Updates storage_used_bytes for users and organizations
 * Only tracks when billing is enabled
 */

import { db } from '@sim/db'
import { organization, userStats, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { isRecordLike } from '@sim/utils/object'
import { and, eq, gte, sql } from 'drizzle-orm'
import { maybeNotifyLimit } from '@/lib/billing/core/limit-notifications'
import type { HighestPrioritySubscription } from '@/lib/billing/core/plan'
import type { BillingEntity } from '@/lib/billing/core/usage-log'
import {
  resolveStorageBillingContext,
  type StorageBillingContext,
} from '@/lib/billing/storage/context'
import { getLegacyStorageBillingEntity } from '@/lib/billing/storage/entity'
import {
  getStorageLimitForBillingContext,
  getStorageUsageForBillingContext,
  getUserStorageLimit,
  getUserStorageUsage,
} from '@/lib/billing/storage/limits'
import { getFreeTierLimit, isOrgScopedSubscription } from '@/lib/billing/subscriptions/utils'
import { isBillingEnabled } from '@/lib/core/config/env-flags'
import type { DbOrTx } from '@/lib/db/types'

const logger = createLogger('StorageTracking')

type StorageCounterMutation = 'increment' | 'decrement'

interface WorkspaceStorageMutationResult {
  updatedUsage: number
}

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
  mutation: StorageCounterMutation,
  strictDecrement = false,
  maximumUsage?: number
): Promise<number | undefined> {
  if (billingEntity.type === 'organization') {
    const storageUsedBytes =
      mutation === 'increment'
        ? sql`${organization.storageUsedBytes} + ${bytes}`
        : sql`GREATEST(0, ${organization.storageUsedBytes} - ${bytes})`
    const returned: unknown = await executor
      .update(organization)
      .set({ storageUsedBytes })
      .where(
        mutation === 'increment' && maximumUsage !== undefined
          ? and(
              eq(organization.id, billingEntity.id),
              sql`${organization.storageUsedBytes} + ${bytes} <= ${maximumUsage}`
            )
          : mutation === 'decrement' && strictDecrement
            ? and(eq(organization.id, billingEntity.id), gte(organization.storageUsedBytes, bytes))
            : eq(organization.id, billingEntity.id)
      )
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
    .where(
      mutation === 'increment' && maximumUsage !== undefined
        ? and(
            eq(userStats.userId, billingEntity.id),
            sql`${userStats.storageUsedBytes} + ${bytes} <= ${maximumUsage}`
          )
        : mutation === 'decrement' && strictDecrement
          ? and(eq(userStats.userId, billingEntity.id), gte(userStats.storageUsedBytes, bytes))
          : eq(userStats.userId, billingEntity.id)
    )
    .returning({ storageUsedBytes: userStats.storageUsedBytes })
  return readReturnedStorageUsage(returned)
}

/**
 * Mutates the durable workspace total and its current routed payer as one
 * transaction. The workspace row is the serialization point shared with payer
 * transfers, so an upload/delete is wholly before or wholly after a move.
 *
 * The per-workspace counter is authoritative for transfer size. Decrements
 * apply only the bytes still present in that workspace, making retries
 * idempotent and preventing either counter from becoming negative.
 */
async function mutateWorkspaceStorageUsage(
  tx: DbOrTx,
  workspaceId: string,
  bytes: number,
  mutation: StorageCounterMutation,
  maximumUsage?: number
): Promise<WorkspaceStorageMutationResult> {
  const [workspacePayer] = await tx
    .select({
      billedAccountUserId: workspace.billedAccountUserId,
      organizationId: workspace.organizationId,
      storageUsedBytes: workspace.storageUsedBytes,
    })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .for('update')
    .limit(1)

  if (!workspacePayer) {
    throw new Error(`Workspace ${workspaceId} not found for storage accounting`)
  }

  const appliedBytes =
    mutation === 'increment' ? bytes : Math.min(bytes, workspacePayer.storageUsedBytes)
  const nextWorkspaceUsage =
    mutation === 'increment'
      ? workspacePayer.storageUsedBytes + appliedBytes
      : workspacePayer.storageUsedBytes - appliedBytes
  const billingEntity: BillingEntity = workspacePayer.organizationId
    ? { type: 'organization', id: workspacePayer.organizationId }
    : { type: 'user', id: workspacePayer.billedAccountUserId }

  if (appliedBytes > 0) {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`workspace-storage-payer:${billingEntity.type}:${billingEntity.id}`}, 0))`
    )
    await tx
      .update(workspace)
      .set({ storageUsedBytes: nextWorkspaceUsage })
      .where(eq(workspace.id, workspaceId))

    const updatedUsage = await mutateStorageUsage(
      tx,
      billingEntity,
      appliedBytes,
      mutation,
      mutation === 'decrement',
      maximumUsage
    )
    if (updatedUsage === undefined) {
      if (mutation === 'increment' && maximumUsage !== undefined) {
        const currentUsage = await readStorageUsageForMutation(tx, billingEntity)
        const newUsage = currentUsage + appliedBytes
        if (newUsage > maximumUsage) {
          throw new Error(
            `Storage limit exceeded. Used: ${(newUsage / 1024 ** 3).toFixed(2)}GB, Limit: ${(maximumUsage / 1024 ** 3).toFixed(0)}GB`
          )
        }
      }
      throw new Error(
        `Storage payer ${billingEntity.type}:${billingEntity.id} is missing or below ${appliedBytes} bytes for workspace ${workspaceId}`
      )
    }

    return { updatedUsage }
  }

  const updatedUsage = await readStorageUsageForMutation(tx, billingEntity)
  return { updatedUsage }
}

/**
 * Reads a payer counter on the current transaction for a no-op/idempotent
 * workspace decrement.
 */
async function readStorageUsageForMutation(
  tx: DbOrTx,
  billingEntity: Readonly<BillingEntity>
): Promise<number> {
  if (billingEntity.type === 'organization') {
    const [row] = await tx
      .select({ storageUsedBytes: organization.storageUsedBytes })
      .from(organization)
      .where(eq(organization.id, billingEntity.id))
      .limit(1)
    if (!row) throw new Error(`Storage payer organization:${billingEntity.id} not found`)
    return row.storageUsedBytes
  }

  const [row] = await tx
    .select({ storageUsedBytes: userStats.storageUsedBytes })
    .from(userStats)
    .where(eq(userStats.userId, billingEntity.id))
    .limit(1)
  if (!row) throw new Error(`Storage payer user:${billingEntity.id} not found`)
  return row.storageUsedBytes
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
export async function maybeNotifyStorageLimit(
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
export async function maybeNotifyStorageLimitForBillingContext(
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
    const result = await db.transaction((tx) =>
      mutateWorkspaceStorageUsage(tx, context.workspaceId, bytes, 'increment')
    )
    updatedUsage = result.updatedUsage
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
    const result = await db.transaction((tx) =>
      mutateWorkspaceStorageUsage(tx, context.workspaceId, bytes, 'decrement')
    )
    updatedUsage = result.updatedUsage
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
  if (bytes <= 0) return

  if (workspaceId) {
    const context = await resolveStorageBillingContext(workspaceId)
    await incrementStorageUsageForBillingContext(context, bytes)
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
  if (bytes <= 0) return

  if (workspaceId) {
    const context = await resolveStorageBillingContext(workspaceId)
    await decrementStorageUsageForBillingContext(context, bytes)
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
  await mutateWorkspaceStorageUsage(tx, context.workspaceId, bytes, 'decrement')
}

/**
 * Increments one workspace and its current payer inside an existing
 * transaction. Used when the billable metadata row is inserted in that same
 * transaction.
 */
export async function incrementStorageUsageForBillingContextInTx(
  tx: DbOrTx,
  context: StorageBillingContext,
  bytes: number
): Promise<number | undefined> {
  if (!isBillingEnabled || bytes <= 0) return undefined
  const limit = getStorageLimitForBillingContext(context)
  const result = await mutateWorkspaceStorageUsage(
    tx,
    context.workspaceId,
    bytes,
    'increment',
    limit
  )
  return result.updatedUsage
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
  tx: DbOrTx,
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
