import { db } from '@sim/db'
import { knowledgeBase, knowledgeConnector } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { isRecordLike } from '@sim/utils/object'
import { idempotencyKeys, tasks } from '@trigger.dev/sdk'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import {
  assertBillingAttributionOwner,
  assertBillingAttributionSnapshot,
  type BillingAttributionSnapshot,
} from '@/lib/billing/core/billing-attribution'
import { resolveTriggerRegion } from '@/lib/core/async-jobs/region'
import {
  CONTENT_ENGINE_ACCESS_MODES,
  isContentEngineAccessMode,
} from '@/lib/knowledge/connectors/access-modes'
import { executeSync, isConnectorRunnableStatus } from '@/lib/knowledge/connectors/sync-engine'
import { connectorIsLive, LOCKABLE_CONNECTOR_STATUSES } from '@/lib/knowledge/connectors/sync-lock'
import { isTriggerAvailable } from '@/lib/knowledge/documents/service'

const logger = createLogger('ConnectorSyncQueue')

export interface ConnectorSyncPayload {
  connectorId: string
  fullSync?: boolean
  /** Skip automatic work if the connector is paused or disabled before execution starts. */
  requireRunnable?: boolean
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
  expectedNextSyncAt?: Date
  fullSync?: boolean
  requireRunnable?: boolean
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
  if (value.requireRunnable !== undefined && typeof value.requireRunnable !== 'boolean') {
    throw new Error('Connector sync payload requireRunnable must be a boolean when provided')
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
    requireRunnable: value.requireRunnable as boolean | undefined,
    rehydrate: value.rehydrate as boolean | undefined,
    requestId: value.requestId,
    billingAttribution: assertBillingAttributionSnapshot(value.billingAttribution),
    dispatchToken: value.dispatchToken as string | undefined,
  }
}

export const SYNC_DISPATCH_FAILED_ERROR = 'Sync could not be queued'

/** The row already carries a queued or running sync. */
const SYNC_ALREADY_QUEUED_REASON = 'A sync is already queued or running for this connector'

/**
 * Whether a dispatch actually put a run on the queue.
 *
 * Every guard in {@link dispatchSync} used to return `void`, so a caller could
 * not tell a queued sync from one that was silently skipped, and reported — and
 * audited — work that was never started. `reason` is worded for whoever reads
 * it in an API response or a log, not as an internal token.
 */
export interface SyncDispatchResult {
  queued: boolean
  /** Present only when the sync was not queued. */
  reason?: string
}

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
 * Deliberately still writes an unowned row already `pending`. The create path is
 * born `pending` in its INSERT but carries no lease and no token, so skipping it
 * as a redundant write would leave every new connector ageing against
 * `updatedAt`. A pending row that already has a token is not taken again: that
 * token proves a hand-off already owns it, and replacing it would make the
 * queued task unable to acquire the lock.
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
        inArray(knowledgeConnector.accessMode, CONTENT_ENGINE_ACCESS_MODES),
        inArray(knowledgeConnector.status, LOCKABLE_CONNECTOR_STATUSES),
        isNull(knowledgeConnector.syncLockToken),
        connectorIsLive()
      )
    )
    .returning({ id: knowledgeConnector.id })

  return taken.length > 0 ? dispatchToken : null
}

/**
 * Explains a queue entry {@link markSyncPending} did not take.
 *
 * Its condition matches on three independent things — the connector is live, it
 * holds no token, and its status is one a run may start from — so the write
 * failing does not say which of them refused. Reporting the queued-or-running
 * reason for all three told a caller whose connector was archived or deleted in
 * the window after the dispatch guards read the row that a sync was already
 * running: false, and unactionable. This re-read costs one query on a path that
 * is already queueing nothing, and the row it sees may have moved again — so it
 * reports the lifecycle verdicts from the row as it stands now and falls back to
 * the queue reason for everything else.
 */
async function describeUnacceptedSync(connectorId: string): Promise<string> {
  const [row] = await db
    .select({
      status: knowledgeConnector.status,
      archivedAt: knowledgeConnector.archivedAt,
      deletedAt: knowledgeConnector.deletedAt,
    })
    .from(knowledgeConnector)
    .where(eq(knowledgeConnector.id, connectorId))
    .limit(1)

  if (!row) return 'Connector no longer exists'
  if (row.archivedAt || row.deletedAt) return 'Connector has been archived or deleted'
  if (row.status !== 'syncing' && !isLockableConnectorStatus(row.status)) {
    return `Connector is ${row.status} and cannot start a sync`
  }
  return SYNC_ALREADY_QUEUED_REASON
}

function isLockableConnectorStatus(status: string): boolean {
  return (LOCKABLE_CONNECTOR_STATUSES as readonly string[]).includes(status)
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
): Promise<SyncDispatchResult> {
  if (!isNonEmptyString(connectorId)) {
    throw new Error('Connector sync dispatch requires a connector ID')
  }
  if (
    options.requireRunnable &&
    (!(options.expectedNextSyncAt instanceof Date) ||
      Number.isNaN(options.expectedNextSyncAt.getTime()))
  ) {
    throw new Error('Automatic connector sync dispatch requires the expected next sync time')
  }

  const requestId = options?.requestId ?? generateId()
  const payload = assertConnectorSyncPayload({
    connectorId,
    fullSync: options?.fullSync,
    requireRunnable: options?.requireRunnable,
    rehydrate: options?.rehydrate,
    requestId,
    billingAttribution: options?.billingAttribution,
  })

  const connectorRows = await db
    .select({
      knowledgeBaseId: knowledgeConnector.knowledgeBaseId,
      connectorStatus: knowledgeConnector.status,
      connectorAccessMode: knowledgeConnector.accessMode,
      connectorArchivedAt: knowledgeConnector.archivedAt,
      connectorDeletedAt: knowledgeConnector.deletedAt,
      connectorNextSyncAt: knowledgeConnector.nextSyncAt,
      workspaceId: knowledgeBase.workspaceId,
      organizationId: knowledgeBase.organizationId,
      kbDeletedAt: knowledgeBase.deletedAt,
    })
    .from(knowledgeConnector)
    .innerJoin(knowledgeBase, eq(knowledgeBase.id, knowledgeConnector.knowledgeBaseId))
    .where(eq(knowledgeConnector.id, connectorId))
    .limit(1)

  const row = connectorRows[0]
  if (!row) {
    logger.warn('Skipping sync dispatch: connector not found', { connectorId, requestId })
    return { queued: false, reason: 'Connector no longer exists' }
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
    return { queued: false, reason: 'Knowledge base has been deleted' }
  }
  if (row.connectorArchivedAt || row.connectorDeletedAt) {
    logger.warn('Skipping sync dispatch: connector is archived or deleted', {
      connectorId,
      requestId,
    })
    return { queued: false, reason: 'Connector has been archived or deleted' }
  }
  if (!isContentEngineAccessMode(row.connectorAccessMode)) {
    logger.info('Skipping sync dispatch: connector syncs per member', { connectorId, requestId })
    return {
      queued: false,
      reason: 'Connector syncs per member and is not synced as the workspace',
    }
  }
  if (payload.requireRunnable && !isConnectorRunnableStatus(row.connectorStatus)) {
    logger.info('Skipping automatic sync dispatch: connector is not runnable', {
      connectorId,
      status: row.connectorStatus,
      requestId,
    })
    return {
      queued: false,
      reason: `Connector is ${row.connectorStatus} and is not synced automatically`,
    }
  }
  if (
    options.expectedNextSyncAt &&
    row.connectorNextSyncAt?.getTime() !== options.expectedNextSyncAt.getTime()
  ) {
    logger.info('Skipping stale automatic sync dispatch: next sync time changed', {
      connectorId,
      requestId,
    })
    return {
      queued: false,
      reason: 'The connector sync schedule changed after this run was scheduled',
    }
  }
  if (!row.workspaceId && !row.organizationId) {
    throw new Error(`Connector ${connectorId} is missing workspace billing context`)
  }
  assertBillingAttributionOwner(payload.billingAttribution, row)

  const tags = [
    `connectorId:${connectorId}`,
    `knowledgeBaseId:${row.knowledgeBaseId}`,
    row.workspaceId ? `workspaceId:${row.workspaceId}` : `organizationId:${row.organizationId}`,
    `userId:${payload.billingAttribution.actorUserId}`,
  ]

  if (isTriggerAvailable()) {
    const dispatchToken = await markSyncPending(connectorId)
    if (!dispatchToken) {
      const reason = await describeUnacceptedSync(connectorId)
      logger.info('Skipping sync dispatch: connector is not accepting a queued sync', {
        connectorId,
        reason,
        requestId,
      })
      return { queued: false, reason }
    }

    /**
     * Everything between taking the queue entry and the hand-off landing has to
     * sit inside this `try`. Resolving the region concurrently with
     * `markSyncPending` looked free, but its rejection escaped before the token
     * was ever bound, so the release below could not run and the row was left
     * `pending` until the reaper's TTL.
     */
    try {
      const idempotencyKey = options.expectedNextSyncAt
        ? await idempotencyKeys.create(
            `knowledge-connector-sync:${connectorId}:${options.expectedNextSyncAt.toISOString()}`,
            { scope: 'global' }
          )
        : undefined
      await tasks.trigger(
        'knowledge-connector-sync',
        { ...payload, dispatchToken },
        {
          ...(idempotencyKey ? { idempotencyKey } : {}),
          tags,
          region: await resolveTriggerRegion(),
        }
      )
    } catch (error) {
      await releaseFailedDispatch(connectorId, dispatchToken, error)
      throw error
    }
    logger.info('Dispatched connector sync to Trigger.dev', { connectorId, requestId })
    return { queued: true }
  }

  const dispatchToken = await markSyncPending(connectorId)
  if (!dispatchToken) {
    const reason = await describeUnacceptedSync(connectorId)
    logger.info('Skipping sync execution: connector is not accepting a queued sync', {
      connectorId,
      reason,
      requestId,
    })
    return { queued: false, reason }
  }

  executeSync(connectorId, {
    fullSync: payload.fullSync,
    requireRunnable: payload.requireRunnable,
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

  return { queued: true }
}
