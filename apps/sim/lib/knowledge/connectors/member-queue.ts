import { db } from '@sim/db'
import { knowledgeBase, knowledgeConnector } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { isRecordLike } from '@sim/utils/object'
import { idempotencyKeys, tasks } from '@trigger.dev/sdk'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import {
  assertBillingAttributionSnapshot,
  type BillingAttributionSnapshot,
} from '@/lib/billing/core/billing-attribution'
import { resolveTriggerRegion } from '@/lib/core/async-jobs/region'
import { executeMemberSync } from '@/lib/knowledge/connectors/member-sync-engine'
import {
  SYNC_DISPATCH_FAILED_ERROR,
  type SyncDispatchResult,
} from '@/lib/knowledge/connectors/queue'
import { connectorIsLive } from '@/lib/knowledge/connectors/sync-lock'
import { isTriggerAvailable } from '@/lib/knowledge/documents/service'

const logger = createLogger('ConnectorMemberSyncQueue')

export const MEMBER_SYNC_TASK_ID = 'knowledge-connector-member-sync'

/**
 * Member-sync states a run may be queued from. `pending` is deliberately
 * absent here and present in the engine's lock acquisition: a queue entry is
 * taken once, and the run that consumes it proves it by token.
 */
export const QUEUEABLE_MEMBER_SYNC_STATUSES = ['idle', 'error'] as const

export interface MemberSyncPayload {
  connectorId: string
  requestId: string
  billingAttribution: BillingAttributionSnapshot
  /** The queue entry this task is allowed to consume; see `ConnectorSyncPayload.dispatchToken`. */
  dispatchToken?: string
}

export interface DispatchMemberSyncOptions {
  billingAttribution: BillingAttributionSnapshot
  /** The scheduled instant this dispatch was made for; a changed schedule makes it stale. */
  expectedNextMemberSyncAt?: Date
  /** Skip automatic work unless the connector is idle or recovering from an error. */
  requireRunnable?: boolean
  requestId?: string
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/** Restores and validates member-sync work crossing the asynchronous boundary. */
export function assertMemberSyncPayload(value: unknown): MemberSyncPayload {
  if (!isRecordLike(value)) {
    throw new Error('Member sync payload must be an object')
  }
  if (!isNonEmptyString(value.connectorId) || !isNonEmptyString(value.requestId)) {
    throw new Error('Member sync payload requires connectorId and requestId')
  }
  if (value.dispatchToken !== undefined && !isNonEmptyString(value.dispatchToken)) {
    throw new Error('Member sync payload dispatchToken must be a string when provided')
  }
  if (value.billingAttribution === undefined) {
    throw new Error('Member sync payload requires billing attribution')
  }
  return {
    connectorId: value.connectorId,
    requestId: value.requestId,
    billingAttribution: assertBillingAttributionSnapshot(value.billingAttribution),
    dispatchToken: value.dispatchToken as string | undefined,
  }
}

/**
 * Takes the member-sync queue entry, mirroring `markSyncPending` over the
 * member lease columns. Refuses while the content engine holds its lock, so
 * the two engines can never be queued against one connector at once.
 */
async function markMemberSyncPending(connectorId: string): Promise<string | null> {
  const dispatchToken = generateId()
  const now = new Date()
  const taken = await db
    .update(knowledgeConnector)
    .set({
      memberSyncStatus: 'pending',
      memberSyncLockToken: dispatchToken,
      memberSyncLockLeaseAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(knowledgeConnector.id, connectorId),
        eq(knowledgeConnector.accessMode, 'members'),
        inArray(knowledgeConnector.memberSyncStatus, QUEUEABLE_MEMBER_SYNC_STATUSES),
        isNull(knowledgeConnector.memberSyncLockToken),
        isNull(knowledgeConnector.syncLockToken),
        connectorIsLive()
      )
    )
    .returning({ id: knowledgeConnector.id })
  return taken.length > 0 ? dispatchToken : null
}

async function describeUnacceptedMemberSync(connectorId: string): Promise<string> {
  const [row] = await db
    .select({
      accessMode: knowledgeConnector.accessMode,
      memberSyncStatus: knowledgeConnector.memberSyncStatus,
      syncLockToken: knowledgeConnector.syncLockToken,
      archivedAt: knowledgeConnector.archivedAt,
      deletedAt: knowledgeConnector.deletedAt,
    })
    .from(knowledgeConnector)
    .where(eq(knowledgeConnector.id, connectorId))
    .limit(1)
  if (!row) return 'Connector no longer exists'
  if (row.archivedAt || row.deletedAt) return 'Connector has been archived or deleted'
  if (row.accessMode !== 'members') return 'Connector no longer syncs per member'
  if (row.syncLockToken) return 'A workspace sync is still running for this connector'
  if (row.memberSyncStatus === 'disabled') return 'Member sync is disabled for this connector'
  return 'A member sync is already queued or running for this connector'
}

/**
 * Releases a queued member sync whose hand-off threw. Guarded on this
 * dispatch's own token so a late failure can never clear a replacement's
 * entry, and deliberately not laddered: the queue threw, not the connector.
 */
async function releaseFailedMemberDispatch(
  connectorId: string,
  dispatchToken: string,
  error: unknown
): Promise<void> {
  const now = new Date()
  try {
    await db
      .update(knowledgeConnector)
      .set({
        memberSyncStatus: 'error',
        lastMemberSyncError: SYNC_DISPATCH_FAILED_ERROR,
        nextMemberSyncAt: now,
        memberSyncLockToken: null,
        memberSyncLockLeaseAt: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(knowledgeConnector.id, connectorId),
          eq(knowledgeConnector.memberSyncStatus, 'pending'),
          eq(knowledgeConnector.memberSyncLockToken, dispatchToken),
          connectorIsLive()
        )
      )
  } catch (releaseError) {
    logger.error('Failed to release a connector whose member sync dispatch failed', {
      connectorId,
      dispatchError: toError(error).message,
      releaseError: toError(releaseError).message,
    })
  }
}

/** Dispatches one members-mode run with billing attribution fixed by the caller. */
export async function dispatchMemberSync(
  connectorId: string,
  options: DispatchMemberSyncOptions
): Promise<SyncDispatchResult> {
  if (!isNonEmptyString(connectorId)) {
    throw new Error('Member sync dispatch requires a connector ID')
  }
  if (
    options.requireRunnable &&
    (!(options.expectedNextMemberSyncAt instanceof Date) ||
      Number.isNaN(options.expectedNextMemberSyncAt.getTime()))
  ) {
    throw new Error('Automatic member sync dispatch requires the expected next sync time')
  }

  const requestId = options.requestId ?? generateId()
  const payload = assertMemberSyncPayload({
    connectorId,
    requestId,
    billingAttribution: options.billingAttribution,
  })

  const [row] = await db
    .select({
      knowledgeBaseId: knowledgeConnector.knowledgeBaseId,
      accessMode: knowledgeConnector.accessMode,
      memberSyncStatus: knowledgeConnector.memberSyncStatus,
      nextMemberSyncAt: knowledgeConnector.nextMemberSyncAt,
      archivedAt: knowledgeConnector.archivedAt,
      deletedAt: knowledgeConnector.deletedAt,
      workspaceId: knowledgeBase.workspaceId,
      kbDeletedAt: knowledgeBase.deletedAt,
    })
    .from(knowledgeConnector)
    .innerJoin(knowledgeBase, eq(knowledgeBase.id, knowledgeConnector.knowledgeBaseId))
    .where(eq(knowledgeConnector.id, connectorId))
    .limit(1)

  if (!row) {
    logger.warn('Skipping member sync dispatch: connector not found', { connectorId, requestId })
    return { queued: false, reason: 'Connector no longer exists' }
  }
  if (row.kbDeletedAt) {
    logger.warn('Skipping member sync dispatch: knowledge base is deleted', {
      connectorId,
      knowledgeBaseId: row.knowledgeBaseId,
      requestId,
    })
    await db
      .update(knowledgeConnector)
      .set({
        memberSyncStatus: 'error',
        nextMemberSyncAt: null,
        lastMemberSyncError: 'Knowledge base deleted',
        memberSyncLockToken: null,
        memberSyncLockLeaseAt: null,
        updatedAt: new Date(),
      })
      .where(eq(knowledgeConnector.id, connectorId))
    return { queued: false, reason: 'Knowledge base has been deleted' }
  }
  if (row.archivedAt || row.deletedAt) {
    return { queued: false, reason: 'Connector has been archived or deleted' }
  }
  if (row.accessMode !== 'members') {
    return { queued: false, reason: 'Connector does not sync per member' }
  }
  if (
    payload.dispatchToken === undefined &&
    options.requireRunnable &&
    !QUEUEABLE_MEMBER_SYNC_STATUSES.some((status) => status === row.memberSyncStatus)
  ) {
    return {
      queued: false,
      reason: `Member sync is ${row.memberSyncStatus} and is not run automatically`,
    }
  }
  if (
    options.expectedNextMemberSyncAt &&
    row.nextMemberSyncAt?.getTime() !== options.expectedNextMemberSyncAt.getTime()
  ) {
    return {
      queued: false,
      reason: 'The member sync schedule changed after this run was scheduled',
    }
  }
  if (!row.workspaceId) {
    throw new Error(`Connector ${connectorId} is missing workspace billing context`)
  }
  if (payload.billingAttribution.workspaceId !== row.workspaceId) {
    throw new Error(
      `Member sync billing attribution does not match connector workspace ${row.workspaceId}`
    )
  }

  const dispatchToken = await markMemberSyncPending(connectorId)
  if (!dispatchToken) {
    const reason = await describeUnacceptedMemberSync(connectorId)
    logger.info('Skipping member sync dispatch: connector is not accepting a queued run', {
      connectorId,
      reason,
      requestId,
    })
    return { queued: false, reason }
  }

  if (isTriggerAvailable()) {
    try {
      const idempotencyKey = options.expectedNextMemberSyncAt
        ? await idempotencyKeys.create(
            `${MEMBER_SYNC_TASK_ID}:${connectorId}:${options.expectedNextMemberSyncAt.toISOString()}`,
            { scope: 'global' }
          )
        : undefined
      await tasks.trigger(
        MEMBER_SYNC_TASK_ID,
        { ...payload, dispatchToken },
        {
          ...(idempotencyKey ? { idempotencyKey } : {}),
          tags: [
            `connectorId:${connectorId}`,
            `knowledgeBaseId:${row.knowledgeBaseId}`,
            `workspaceId:${row.workspaceId}`,
            `userId:${payload.billingAttribution.actorUserId}`,
          ],
          region: await resolveTriggerRegion(),
        }
      )
    } catch (error) {
      await releaseFailedMemberDispatch(connectorId, dispatchToken, error)
      throw error
    }
    logger.info('Dispatched member sync to Trigger.dev', { connectorId, requestId })
    return { queued: true }
  }

  executeMemberSync(connectorId, {
    billingAttribution: payload.billingAttribution,
    dispatchToken,
  }).catch(async (error) => {
    logger.error(`Member sync failed for connector ${connectorId}`, {
      error: toError(error).message,
      requestId,
    })
    await releaseFailedMemberDispatch(connectorId, dispatchToken, error)
  })
  return { queued: true }
}
