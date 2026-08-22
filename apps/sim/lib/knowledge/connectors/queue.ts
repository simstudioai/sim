import { db } from '@sim/db'
import { knowledgeBase, knowledgeConnector } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { isRecordLike } from '@sim/utils/object'
import { tasks } from '@trigger.dev/sdk'
import { and, eq, inArray } from 'drizzle-orm'
import {
  assertBillingAttributionSnapshot,
  type BillingAttributionSnapshot,
} from '@/lib/billing/core/billing-attribution'
import { resolveTriggerRegion } from '@/lib/core/async-jobs/region'
import {
  connectorIsLive,
  executeSync,
  LOCKABLE_CONNECTOR_STATUSES,
} from '@/lib/knowledge/connectors/sync-engine'
import { isTriggerAvailable } from '@/lib/knowledge/documents/service'

const logger = createLogger('ConnectorSyncQueue')

export interface ConnectorSyncPayload {
  connectorId: string
  fullSync?: boolean
  /**
   * Force re-hydration + re-indexing of already-synced documents for connectors
   * whose rendered content can drift without a hash change (see
   * `ConnectorMeta.rehydrateOnFullSync`). Forces a full (non-incremental) listing
   * so every document is re-hydrated, but — unlike `fullSync` — keeps every
   * deletion-reconciliation safety guard armed.
   */
  rehydrate?: boolean
  requestId: string
  billingAttribution: BillingAttributionSnapshot
  /**
   * The queue entry this task is allowed to consume, proving the run it starts
   * is the one that was queued for it.
   *
   * Optional only for the rollout window: tasks queued before this field
   * existed carry no token, and the lock falls back to the status check alone
   * for them rather than stranding work already in the queue.
   */
  dispatchToken?: string
}

export interface DispatchSyncOptions {
  billingAttribution: BillingAttributionSnapshot
  fullSync?: boolean
  rehydrate?: boolean
  requestId?: string
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * Restores and validates connector work crossing the asynchronous boundary.
 */
export function assertConnectorSyncPayload(value: unknown): ConnectorSyncPayload {
  if (!isRecordLike(value)) {
    throw new Error('Connector sync payload must be an object')
  }
  if (!isNonEmptyString(value.connectorId) || !isNonEmptyString(value.requestId)) {
    throw new Error('Connector sync payload requires connectorId and requestId')
  }
  if (value.fullSync !== undefined && typeof value.fullSync !== 'boolean') {
    throw new Error('Connector sync payload fullSync must be a boolean when provided')
  }
  if (value.rehydrate !== undefined && typeof value.rehydrate !== 'boolean') {
    throw new Error('Connector sync payload rehydrate must be a boolean when provided')
  }
  if (value.dispatchToken !== undefined && !isNonEmptyString(value.dispatchToken)) {
    throw new Error('Connector sync payload dispatchToken must be a string when provided')
  }
  if (value.billingAttribution === undefined) {
    throw new Error('Connector sync payload requires billing attribution')
  }

  return {
    connectorId: value.connectorId,
    fullSync: value.fullSync as boolean | undefined,
    rehydrate: value.rehydrate as boolean | undefined,
    requestId: value.requestId,
    billingAttribution: assertBillingAttributionSnapshot(value.billingAttribution),
    dispatchToken: value.dispatchToken as string | undefined,
  }
}

export const SYNC_DISPATCH_FAILED_ERROR = 'Sync could not be queued'

/**
 * Marks the connector as having a sync queued, and returns the token that owns
 * that queued sync.
 *
 * Every dispatch path funnels through here, so `pending` is written in one
 * place. It is what lets the UI show a queued sync from server state: until a
 * worker takes the lock there is otherwise nothing on the row distinguishing
 * "a sync is coming" from "idle", which is what previously forced the client to
 * guess from `createdAt`.
 *
 * `pending` is a phase of the same lock `syncing` holds, not a state beside it,
 * so it opens the lease and takes a token exactly as
 * {@link buildSyncLockAcquisition} does. The lease is what the scheduler ages a
 * stranded queue entry against — `updatedAt` cannot serve, because a pending
 * connector is still editable and every unrelated write to the row would renew
 * the recovery it is meant to trigger. The token is what makes the release
 * below provably this dispatch's own.
 *
 * Deliberately still writes a row already `pending`. The create path is born
 * `pending` in its INSERT but carries no lease and no token, so skipping it as
 * a redundant write would leave every new connector ageing against `updatedAt`
 * and holding a token this dispatch cannot match — defeating both guards above
 * on exactly the path where a failed hand-off is most visible. The cost is one
 * extra UPDATE per connector creation, which is rare; the scheduler's own
 * dispatches only ever see `active`/`error` rows and are unaffected.
 *
 * Takes the entry only from a status a run may start from — the same
 * {@link LOCKABLE_CONNECTOR_STATUSES} the lock acquisition uses, so queueing and
 * starting agree on one rule. The dispatch-side guards run before this write and
 * cannot see a status change that races it: without the allowlist, pausing a
 * connector in the window between "Sync now" being accepted and this UPDATE
 * landing would be silently overwritten back to `pending`. Returns `null` when
 * it takes nothing, so the caller can skip a hand-off that would only be refused
 * at the lock.
 */
async function markSyncPending(connectorId: string): Promise<string | null> {
  const dispatchToken = generateId()
  const now = new Date()

  const taken = await db
    .update(knowledgeConnector)
    .set({
      status: 'pending',
      syncLockToken: dispatchToken,
      syncLockLeaseAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(knowledgeConnector.id, connectorId),
        inArray(knowledgeConnector.status, LOCKABLE_CONNECTOR_STATUSES),
        connectorIsLive()
      )
    )
    .returning({ id: knowledgeConnector.id })

  return taken.length > 0 ? dispatchToken : null
}

/**
 * Releases a queued sync whose hand-off threw.
 *
 * Guarded on this dispatch's own token, not merely on `pending`: a hand-off can
 * throw long after the scheduler reclaimed the queue entry and dispatched a
 * replacement, and `status = 'pending'` alone would let this dead dispatch
 * overwrite the live one — the same reason {@link holdsSyncLockToken} exists
 * for `syncing`.
 *
 * Deliberately does NOT advance the failure ladder, unlike the scheduler's
 * recovery of a stranded queue entry. The verdict here is observably about the
 * queue, not the connector: the queue client itself threw. Laddering it would
 * mean a Trigger.dev outage increments every connector in the fleet on every
 * dispatch attempt until they auto-disable, each then needing a manual
 * re-enable for a fault that was never theirs. `nextSyncAt` is pulled to now so
 * the scheduler's due-sweep retries promptly once the queue recovers; a genuine
 * per-connector problem still reaches the breaker through the run itself.
 */
async function releaseFailedDispatch(
  connectorId: string,
  dispatchToken: string,
  error: unknown
): Promise<void> {
  const now = new Date()
  try {
    await db
      .update(knowledgeConnector)
      .set({
        status: 'error',
        lastSyncError: SYNC_DISPATCH_FAILED_ERROR,
        nextSyncAt: now,
        syncLockToken: null,
        syncLockLeaseAt: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(knowledgeConnector.id, connectorId),
          eq(knowledgeConnector.status, 'pending'),
          eq(knowledgeConnector.syncLockToken, dispatchToken),
          connectorIsLive()
        )
      )
  } catch (releaseError) {
    logger.error('Failed to release a connector whose sync dispatch failed', {
      connectorId,
      dispatchError: toError(error).message,
      releaseError: toError(releaseError).message,
    })
  }
}

/**
 * Dispatches a connector sync with billing attribution already fixed by the
 * authenticated or scheduled entry point.
 */
export async function dispatchSync(
  connectorId: string,
  options: DispatchSyncOptions
): Promise<void> {
  if (!isNonEmptyString(connectorId)) {
    throw new Error('Connector sync dispatch requires a connector ID')
  }

  const requestId = options?.requestId ?? generateId()
  const payload = assertConnectorSyncPayload({
    connectorId,
    fullSync: options?.fullSync,
    rehydrate: options?.rehydrate,
    requestId,
    billingAttribution: options?.billingAttribution,
  })

  const connectorRows = await db
    .select({
      knowledgeBaseId: knowledgeConnector.knowledgeBaseId,
      connectorArchivedAt: knowledgeConnector.archivedAt,
      connectorDeletedAt: knowledgeConnector.deletedAt,
      workspaceId: knowledgeBase.workspaceId,
      kbDeletedAt: knowledgeBase.deletedAt,
    })
    .from(knowledgeConnector)
    .innerJoin(knowledgeBase, eq(knowledgeBase.id, knowledgeConnector.knowledgeBaseId))
    .where(eq(knowledgeConnector.id, connectorId))
    .limit(1)

  const row = connectorRows[0]
  if (!row) {
    logger.warn('Skipping sync dispatch: connector not found', { connectorId, requestId })
    return
  }
  if (row.kbDeletedAt) {
    logger.warn('Skipping sync dispatch: knowledge base is deleted', {
      connectorId,
      knowledgeBaseId: row.knowledgeBaseId,
      requestId,
    })
    await db
      .update(knowledgeConnector)
      .set({
        status: 'error',
        nextSyncAt: null,
        lastSyncError: 'Knowledge base deleted',
        /**
         * Clears the lock alongside the status.
         *
         * This write runs BEFORE the lock is taken, but it is unconditional on
         * status, so it can land on a row a previous run left `syncing` — a run
         * that may still be alive. Flipping status without releasing the token
         * left a row that was neither locked nor reclaimable: the reaper only
         * looks at `syncing` rows, and the old run's terminal write could still
         * match its own token and resurrect a state for a knowledge base that no
         * longer exists. Releasing both makes the transition terminal.
         */
        syncLockToken: null,
        syncLockLeaseAt: null,
        updatedAt: new Date(),
      })
      .where(eq(knowledgeConnector.id, connectorId))
    return
  }
  if (row.connectorArchivedAt || row.connectorDeletedAt) {
    logger.warn('Skipping sync dispatch: connector is archived or deleted', {
      connectorId,
      requestId,
    })
    return
  }
  if (!row.workspaceId) {
    throw new Error(`Connector ${connectorId} is missing workspace billing context`)
  }
  if (payload.billingAttribution.workspaceId !== row.workspaceId) {
    throw new Error(
      `Connector sync billing attribution does not match connector workspace ${row.workspaceId}`
    )
  }

  const tags = [
    `connectorId:${connectorId}`,
    `knowledgeBaseId:${row.knowledgeBaseId}`,
    `workspaceId:${row.workspaceId}`,
    `userId:${payload.billingAttribution.actorUserId}`,
  ]

  if (isTriggerAvailable()) {
    const dispatchToken = await markSyncPending(connectorId)
    if (!dispatchToken) {
      logger.info('Skipping sync dispatch: connector is not accepting a queued sync', {
        connectorId,
        requestId,
      })
      return
    }

    /**
     * Everything between taking the queue entry and the hand-off landing has to
     * sit inside this `try`. Resolving the region concurrently with
     * `markSyncPending` looked free, but its rejection escaped before the token
     * was ever bound, so the release below could not run and the row was left
     * `pending` until the reaper's TTL.
     */
    try {
      await tasks.trigger(
        'knowledge-connector-sync',
        { ...payload, dispatchToken },
        { tags, region: await resolveTriggerRegion() }
      )
    } catch (error) {
      await releaseFailedDispatch(connectorId, dispatchToken, error)
      throw error
    }
    logger.info('Dispatched connector sync to Trigger.dev', { connectorId, requestId })
    return
  }

  const dispatchToken = await markSyncPending(connectorId)
  if (!dispatchToken) {
    logger.info('Skipping sync execution: connector is not accepting a queued sync', {
      connectorId,
      requestId,
    })
    return
  }

  executeSync(connectorId, {
    fullSync: payload.fullSync,
    rehydrate: payload.rehydrate,
    billingAttribution: payload.billingAttribution,
    dispatchToken,
  }).catch(async (error) => {
    logger.error(`Sync failed for connector ${connectorId}`, {
      error: toError(error).message,
      requestId,
    })
    /**
     * Only reaches a row still `pending` holding this dispatch's token: once
     * `executeSync` takes the lock it overwrites the token and owns the terminal
     * write. This covers the narrow case where it threw before acquiring it.
     */
    await releaseFailedDispatch(connectorId, dispatchToken, error)
  })
}
