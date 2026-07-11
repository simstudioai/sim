/**
 * Storage usage tracking for durable workspace and payer ledgers.
 */

import { organization, userStats, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { isRecordLike } from '@sim/utils/object'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
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
import { getFreeTierLimit, isOrgScopedSubscription } from '@/lib/billing/subscriptions/utils'
import { isBillingEnabled } from '@/lib/core/config/env-flags'
import type { DbOrTx } from '@/lib/db/types'

const logger = createLogger('StorageTracking')

type StorageCounterMutation = 'increment' | 'decrement'

interface WorkspaceStorageMutationResult {
  updatedUsage: number
}

interface LockedWorkspaceStorage {
  id: string
  billedAccountUserId: string
  organizationId: string | null
  storageUsedBytes: number
}

export interface WorkspaceStorageUsageDelta {
  context: StorageBillingContext
  deltaBytes: number
}

export interface LegacyStorageUsageDelta {
  deltaBytes: number
  subscription: HighestPrioritySubscription | null
  userId: string
}

interface AggregatedPayerStorageDelta {
  billingEntity: BillingEntity
  deltaBytes: number
  maximumUsage?: number
  required: boolean
}

/** Format bytes as a `GB` label for usage-limit emails (2dp usage, whole-number limit). */
function formatGb(bytes: number, decimals: number): string {
  return `${(bytes / 1024 ** 3).toFixed(decimals)} GB`
}

function getPayerKey(billingEntity: Readonly<BillingEntity>): string {
  return `${billingEntity.type}:${billingEntity.id}`
}

function comparePayerKeys(left: string, right: string): number {
  const [leftType, leftId] = left.split(':', 2)
  const [rightType, rightId] = right.split(':', 2)
  if (leftType !== rightType) {
    return leftType === 'user' ? -1 : 1
  }
  return leftId < rightId ? -1 : leftId > rightId ? 1 : 0
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
 * updated value when PostgreSQL reports the matching row. Decrements clamp at
 * zero; rollout-era ledgers may lag behind billable rows, so underflow is
 * repaired by reconciliation rather than failing the caller's transaction.
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
 * Locks and reads the payer ledger after the workspace row has been locked.
 */
async function lockStorageUsageForMutation(
  tx: DbOrTx,
  billingEntity: Readonly<BillingEntity>
): Promise<number> {
  if (billingEntity.type === 'organization') {
    const [row] = await tx
      .select({ storageUsedBytes: organization.storageUsedBytes })
      .from(organization)
      .where(eq(organization.id, billingEntity.id))
      .for('update')
      .limit(1)
    if (!row) throw new Error(`Storage payer organization:${billingEntity.id} not found`)
    return row.storageUsedBytes
  }

  const [row] = await tx
    .select({ storageUsedBytes: userStats.storageUsedBytes })
    .from(userStats)
    .where(eq(userStats.userId, billingEntity.id))
    .for('update')
    .limit(1)
  if (!row) throw new Error(`Storage payer user:${billingEntity.id} not found`)
  return row.storageUsedBytes
}

/**
 * Returns the payer currently routed by a locked workspace row.
 */
function getWorkspaceBillingEntity(row: LockedWorkspaceStorage): BillingEntity {
  return row.organizationId
    ? { type: 'organization', id: row.organizationId }
    : { type: 'user', id: row.billedAccountUserId }
}

/**
 * Rejects an optimistic storage context when the workspace payer changed before
 * the transaction acquired its lock.
 */
function assertWorkspaceStorageContext(
  row: LockedWorkspaceStorage,
  context: StorageBillingContext
): BillingEntity {
  const currentBillingEntity = getWorkspaceBillingEntity(row)
  const expectedBillingEntity = context.billingEntity
  if (
    row.id !== context.workspaceId ||
    currentBillingEntity.type !== expectedBillingEntity.type ||
    currentBillingEntity.id !== expectedBillingEntity.id ||
    row.billedAccountUserId !== context.billedAccountUserId
  ) {
    throw new Error(
      `Storage payer changed for workspace ${context.workspaceId}; resolve a fresh billing context`
    )
  }
  return currentBillingEntity
}

/**
 * Applies signed workspace and legacy storage deltas in the canonical lock
 * order: sorted workspace rows, sorted user payer rows, then sorted
 * organization payer rows. Negative historical drift is clamped and logged;
 * positive deltas retain quota admission.
 */
export async function applyStorageUsageDeltasInTx(
  tx: DbOrTx,
  params: {
    workspaceDeltas: WorkspaceStorageUsageDelta[]
    legacyDeltas: LegacyStorageUsageDelta[]
  }
): Promise<number | undefined> {
  const workspaceDeltaById = new Map<
    string,
    { context: StorageBillingContext; deltaBytes: number }
  >()
  for (const delta of params.workspaceDeltas) {
    if (!Number.isSafeInteger(delta.deltaBytes)) {
      throw new Error(`Invalid storage delta for workspace ${delta.context.workspaceId}`)
    }
    const existing = workspaceDeltaById.get(delta.context.workspaceId)
    if (existing) {
      assertWorkspaceStorageContext(
        {
          id: delta.context.workspaceId,
          billedAccountUserId: existing.context.billedAccountUserId,
          organizationId:
            existing.context.billingEntity.type === 'organization'
              ? existing.context.billingEntity.id
              : null,
          storageUsedBytes: 0,
        },
        delta.context
      )
      existing.deltaBytes += delta.deltaBytes
      if (!Number.isSafeInteger(existing.deltaBytes)) {
        throw new Error(`Storage delta exceeds the safe integer range`)
      }
    } else {
      workspaceDeltaById.set(delta.context.workspaceId, {
        context: delta.context,
        deltaBytes: delta.deltaBytes,
      })
    }
  }

  const workspaceIds = [...workspaceDeltaById.keys()].sort()
  const lockedWorkspaces =
    workspaceIds.length > 0
      ? await tx
          .select({
            id: workspace.id,
            billedAccountUserId: workspace.billedAccountUserId,
            organizationId: workspace.organizationId,
            storageUsedBytes: workspace.storageUsedBytes,
          })
          .from(workspace)
          .where(inArray(workspace.id, workspaceIds))
          .orderBy(asc(workspace.id))
          .for('update')
      : []
  const workspaceById = new Map(lockedWorkspaces.map((row) => [row.id, row]))

  const payerDeltaByKey = new Map<string, AggregatedPayerStorageDelta>()
  const addPayerDelta = (
    billingEntity: BillingEntity,
    deltaBytes: number,
    maximumUsage: number | undefined,
    required: boolean
  ) => {
    const key = getPayerKey(billingEntity)
    const existing = payerDeltaByKey.get(key)
    const nextDelta = (existing?.deltaBytes ?? 0) + deltaBytes
    if (!Number.isSafeInteger(nextDelta)) {
      throw new Error(`Storage payer ${key} delta exceeds the safe integer range`)
    }
    payerDeltaByKey.set(key, {
      billingEntity,
      deltaBytes: nextDelta,
      maximumUsage:
        maximumUsage === undefined
          ? existing?.maximumUsage
          : existing?.maximumUsage === undefined
            ? maximumUsage
            : Math.min(existing.maximumUsage, maximumUsage),
      required: required || existing?.required === true,
    })
  }

  for (const workspaceId of workspaceIds) {
    const delta = workspaceDeltaById.get(workspaceId)
    const lockedWorkspace = workspaceById.get(workspaceId)
    if (!delta || !lockedWorkspace) {
      throw new Error(`Workspace ${workspaceId} not found for storage accounting`)
    }
    const billingEntity = assertWorkspaceStorageContext(lockedWorkspace, delta.context)
    addPayerDelta(
      billingEntity,
      delta.deltaBytes,
      delta.deltaBytes > 0 && isBillingEnabled
        ? getStorageLimitForBillingContext(delta.context)
        : undefined,
      true
    )
  }

  for (const delta of params.legacyDeltas) {
    if (!Number.isSafeInteger(delta.deltaBytes)) {
      throw new Error(`Invalid legacy storage delta for user ${delta.userId}`)
    }
    const billingEntity = getLegacyStorageBillingEntity(delta.userId, delta.subscription)
    const maximumUsage =
      delta.deltaBytes > 0 && isBillingEnabled
        ? await getUserStorageLimit(delta.userId, delta.subscription)
        : undefined
    addPayerDelta(billingEntity, delta.deltaBytes, maximumUsage, delta.deltaBytes > 0)
  }

  const sortedPayers = [...payerDeltaByKey.entries()].sort(([left], [right]) =>
    comparePayerKeys(left, right)
  )
  const payerUsageByKey = new Map<string, number | null>(sortedPayers.map(([key]) => [key, null]))
  const userIds = sortedPayers.flatMap(([, payer]) =>
    payer.billingEntity.type === 'user' ? [payer.billingEntity.id] : []
  )
  const organizationIds = sortedPayers.flatMap(([, payer]) =>
    payer.billingEntity.type === 'organization' ? [payer.billingEntity.id] : []
  )

  if (userIds.length > 0) {
    const rows = await tx
      .select({ id: userStats.userId, storageUsedBytes: userStats.storageUsedBytes })
      .from(userStats)
      .where(inArray(userStats.userId, userIds))
      .orderBy(asc(userStats.userId))
      .for('update')
    for (const row of rows) {
      payerUsageByKey.set(getPayerKey({ type: 'user', id: row.id }), row.storageUsedBytes)
    }
  }
  if (organizationIds.length > 0) {
    const rows = await tx
      .select({ id: organization.id, storageUsedBytes: organization.storageUsedBytes })
      .from(organization)
      .where(inArray(organization.id, organizationIds))
      .orderBy(asc(organization.id))
      .for('update')
    for (const row of rows) {
      payerUsageByKey.set(getPayerKey({ type: 'organization', id: row.id }), row.storageUsedBytes)
    }
  }

  const nextPayerUsageByKey = new Map<string, number>()
  let destinationUpdatedUsage: number | undefined
  for (const [key, payerDelta] of sortedPayers) {
    const currentUsage = payerUsageByKey.get(key)
    if (currentUsage === null || currentUsage === undefined) {
      if (payerDelta.required) {
        throw new Error(`Storage payer ${key} not found`)
      }
      logger.error('Legacy storage payer is missing during decrement', {
        payer: key,
        decrementBytes: Math.max(0, -payerDelta.deltaBytes),
      })
      continue
    }

    const nextUsage = Math.max(0, currentUsage + payerDelta.deltaBytes)
    if (payerDelta.deltaBytes < 0 && currentUsage < -payerDelta.deltaBytes) {
      logger.error('Clamping storage payer ledger underflow', {
        payer: key,
        currentBytes: currentUsage,
        decrementBytes: -payerDelta.deltaBytes,
      })
    }
    if (
      payerDelta.deltaBytes > 0 &&
      payerDelta.maximumUsage !== undefined &&
      nextUsage > payerDelta.maximumUsage
    ) {
      throw new Error(
        `Storage limit exceeded. Used: ${(nextUsage / 1024 ** 3).toFixed(2)}GB, Limit: ${(payerDelta.maximumUsage / 1024 ** 3).toFixed(0)}GB`
      )
    }
    /**
     * A zero net delta (e.g. a same-payer workspace transfer) needs no payer
     * write; the existence check above already ran while the row was locked.
     */
    if (payerDelta.deltaBytes === 0) continue
    nextPayerUsageByKey.set(key, nextUsage)
    if (payerDelta.deltaBytes > 0) {
      destinationUpdatedUsage = nextUsage
    }
  }

  for (const workspaceId of workspaceIds) {
    const delta = workspaceDeltaById.get(workspaceId)
    const lockedWorkspace = workspaceById.get(workspaceId)
    if (!delta || !lockedWorkspace) continue
    if (delta.deltaBytes < 0 && lockedWorkspace.storageUsedBytes < -delta.deltaBytes) {
      logger.error('Clamping workspace storage ledger underflow', {
        workspaceId,
        currentBytes: lockedWorkspace.storageUsedBytes,
        decrementBytes: -delta.deltaBytes,
      })
    }
    await tx
      .update(workspace)
      .set({ storageUsedBytes: Math.max(0, lockedWorkspace.storageUsedBytes + delta.deltaBytes) })
      .where(eq(workspace.id, workspaceId))
  }

  for (const [key, payerDelta] of sortedPayers) {
    const nextUsage = nextPayerUsageByKey.get(key)
    if (nextUsage === undefined) continue
    if (payerDelta.billingEntity.type === 'user') {
      await tx
        .update(userStats)
        .set({ storageUsedBytes: nextUsage })
        .where(eq(userStats.userId, payerDelta.billingEntity.id))
    } else {
      await tx
        .update(organization)
        .set({ storageUsedBytes: nextUsage })
        .where(eq(organization.id, payerDelta.billingEntity.id))
    }
  }

  return destinationUpdatedUsage
}

/**
 * Mutates the durable workspace total and its current routed payer as one
 * transaction. The workspace row is the serialization point shared with payer
 * transfers, so an upload/delete is wholly before or wholly after a move.
 *
 * The pre-resolved billing context is an optimistic payer assertion. A payer
 * change forces the caller to resolve a fresh context instead of silently
 * charging a different account with stale quota metadata.
 */
async function mutateWorkspaceStorageUsage(
  tx: DbOrTx,
  workspaceId: string,
  bytes: number,
  mutation: StorageCounterMutation,
  maximumUsage: number | undefined,
  context: StorageBillingContext
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

  const billingEntity = assertWorkspaceStorageContext(
    { id: workspaceId, ...workspacePayer },
    context
  )
  const currentPayerUsage = await lockStorageUsageForMutation(tx, billingEntity)

  if (mutation === 'decrement' && workspacePayer.storageUsedBytes < bytes) {
    logger.error('Clamping workspace storage ledger underflow', {
      workspaceId,
      currentBytes: workspacePayer.storageUsedBytes,
      decrementBytes: bytes,
    })
  }
  if (mutation === 'decrement' && currentPayerUsage < bytes) {
    logger.error('Clamping storage payer ledger underflow', {
      payer: getPayerKey(billingEntity),
      currentBytes: currentPayerUsage,
      decrementBytes: bytes,
    })
  }
  if (
    mutation === 'increment' &&
    maximumUsage !== undefined &&
    currentPayerUsage + bytes > maximumUsage
  ) {
    const newUsage = currentPayerUsage + bytes
    throw new Error(
      `Storage limit exceeded. Used: ${(newUsage / 1024 ** 3).toFixed(2)}GB, Limit: ${(maximumUsage / 1024 ** 3).toFixed(0)}GB`
    )
  }

  const nextWorkspaceUsage =
    mutation === 'increment'
      ? workspacePayer.storageUsedBytes + bytes
      : Math.max(0, workspacePayer.storageUsedBytes - bytes)

  if (bytes > 0) {
    await tx
      .update(workspace)
      .set({ storageUsedBytes: nextWorkspaceUsage })
      .where(eq(workspace.id, workspaceId))

    const updatedUsage = await mutateStorageUsage(tx, billingEntity, bytes, mutation)
    if (updatedUsage === undefined) {
      throw new Error(
        `Storage payer ${billingEntity.type}:${billingEntity.id} is missing for workspace ${workspaceId}`
      )
    }

    return { updatedUsage }
  }

  return { updatedUsage: currentPayerUsage }
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
  if (!isBillingEnabled) return

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
 * Decrements the exact workspace payer's storage counter inside an existing
 * transaction.
 */
export async function decrementStorageUsageForBillingContextInTx(
  tx: DbOrTx,
  context: StorageBillingContext,
  bytes: number
): Promise<void> {
  if (bytes <= 0) return
  await mutateWorkspaceStorageUsage(tx, context.workspaceId, bytes, 'decrement', undefined, context)
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
  if (bytes <= 0) return undefined
  const limit = isBillingEnabled ? getStorageLimitForBillingContext(context) : undefined
  const result = await mutateWorkspaceStorageUsage(
    tx,
    context.workspaceId,
    bytes,
    'increment',
    limit,
    context
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
 * the old read-then-decide-then-increment-after-commit split, which left a
 * window between the read and the increment. This helper does not send
 * notifications because it runs mid-transaction.
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
