import { db } from '@sim/db'
import {
  document,
  knowledgeBase,
  knowledgeConnector,
  knowledgeConnectorSyncLog,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { randomInt } from '@sim/utils/random'
import { and, asc, eq, exists, gt, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm'
import {
  assertBillingAttributionOwner,
  assertBillingAttributionSnapshot,
  type BillingAttributionSnapshot,
} from '@/lib/billing/core/billing-attribution'
import { resourceScopeFields, resourceScopeFromOwner } from '@/lib/core/resource-scope'
import { EMPTY_ACL } from '@/lib/knowledge/access/tokens'
import {
  CONTENT_ENGINE_ACCESS_MODES,
  effectiveConnectorSyncIntervalMinutes,
  isContentEngineAccessMode,
  mirrorsSourceAcls,
} from '@/lib/knowledge/connectors/access-modes'
import {
  type ConnectorAccessToken,
  resolveConnectorAccessToken,
  resolveConnectorTokenUserId,
  syncContextForToken,
} from '@/lib/knowledge/connectors/access-token'
import {
  DIRECTORY_ERROR_PREFIX,
  refreshMirroredDirectory,
} from '@/lib/knowledge/connectors/external-group-sync'
import { listingFingerprint } from '@/lib/knowledge/connectors/listing-checkpoint'
import { rewriteConnectorAcls } from '@/lib/knowledge/connectors/member-observations'
import {
  hideUnlistedDocuments,
  mergeMirroredAcls,
  unansweredByListing,
} from '@/lib/knowledge/connectors/mirrored-acls'
import { runConnectorContentPass } from '@/lib/knowledge/connectors/sync-content-pass'
import {
  CONNECTOR_AUTO_DISABLED_ERROR,
  CONNECTOR_FAILURE_BACKOFF_CAP_MINUTES,
  CONNECTOR_SYNC_MAX_DURATION_SECONDS,
  connectorFailureBackoffMinutes,
  MAX_CONSECUTIVE_FAILURES,
} from '@/lib/knowledge/connectors/sync-limits'
import {
  assertSyncLeaseHeldInTx,
  buildSyncLockAcquisition,
  createContentSyncLease,
  holdsSyncLockToken,
  LOCKABLE_CONNECTOR_STATUSES,
  RUNNABLE_CONNECTOR_STATUSES,
  SyncLockLostException,
  type SyncRunLease,
  stillHoldsSyncLock,
} from '@/lib/knowledge/connectors/sync-lock'
import {
  type KnowledgeBaseOwner,
  persistDocumentAcls,
  restoreWorkspaceDocumentAcls,
} from '@/lib/knowledge/connectors/sync-persistence'
import {
  ConnectorDeletedException,
  ConnectorSyncCapacityError,
  checkSyncTargetPresence,
  RETRY_WINDOW_DAYS,
  shouldRunIncrementalSync,
  sweepStuckDocuments,
} from '@/lib/knowledge/connectors/sync-primitives'
import { hardDeleteDocuments } from '@/lib/knowledge/documents/service'
import { getRetryAfterMs, isRateLimitError } from '@/lib/knowledge/documents/utils'
import { CONNECTOR_REGISTRY } from '@/connectors/registry.server'
import type {
  ConnectorAuthConfig,
  ConnectorConfig,
  ExternalDocument,
  SyncResult,
} from '@/connectors/types'

const logger = createLogger('ConnectorSyncEngine')

const RATE_LIMIT_RETRY_JITTER_MAX_MS = 60_000
const CONNECTOR_DELETION_CLEANUP_BATCH_SIZE = 250

export {
  resolveStaleProcessingMinutes,
  worstCaseProcessingMinutes,
} from '@/lib/knowledge/documents/types'

/**
 * Writes the ACLs an admin-mode listing mirrored from the source.
 *
 * Reads the whole listing, not just the documents whose content changed: a
 * membership or sharing change moves no content, so restricting this to changed
 * documents would let a revoked grant stay readable until somebody happened to
 * edit the file.
 *
 * A listed document the connector could not speak for gets an empty ACL, which
 * hides it. That is the safe direction and it is visible — a connector
 * declaring {@link ConnectorMeta.mirrorsSourceAcls} is promising an ACL for
 * every document it lists, so a missing one is a bug in the connector rather
 * than an expected state to paper over.
 */
async function applySourceMirroredAcls(input: {
  connectorId: string
  connectorConfig: ConnectorConfig
  sourceConfig: Record<string, unknown>
  syncContext: Record<string, unknown>
  accessToken: string
  externalDocs: readonly ExternalDocument[]
  /** External ids of every live document the connector owns, listed this run or not. */
  ownedExternalIds: readonly (string | null)[]
  lease?: SyncRunLease
}): Promise<void> {
  const { connectorId, connectorConfig, externalDocs } = input

  /**
   * Whatever the listing could not answer is asked for once, in one batch. Its
   * failure is deliberately not caught: an ACL pass that resolved nothing would
   * hide the entire corpus, which is far worse than leaving the previous ACLs in
   * place until the next run.
   */
  const unanswered = unansweredByListing(externalDocs)
  const fetched =
    unanswered.length > 0 && connectorConfig.getDocumentAcls
      ? await connectorConfig.getDocumentAcls(
          input.accessToken,
          input.sourceConfig,
          unanswered,
          input.syncContext
        )
      : {}
  const { acls, unattributed } = mergeMirroredAcls(externalDocs, fetched)
  const listed = acls.size
  /**
   * A document this run did not list has no ACL this run can vouch for, so it
   * is hidden rather than left under the last one it was given. Deletion
   * reconciliation decides separately, and later, whether it is gone; a held
   * reconciliation keeps the row, but never keeps it readable.
   */
  const unlisted = hideUnlistedDocuments(acls, input.ownedExternalIds)

  const written = input.lease
    ? await db.transaction(async (tx) => {
        await assertSyncLeaseHeldInTx(tx, connectorId, input.lease!)
        return persistDocumentAcls(connectorId, acls, tx)
      })
    : await persistDocumentAcls(connectorId, acls)
  logger.info('Mirrored source permissions onto connector documents', {
    connectorId,
    listed,
    ...written,
    ...(unlisted > 0 ? { unlisted } : {}),
    ...(unattributed > 0 ? { unattributed } : {}),
  })
  if (unattributed > 0) {
    logger.error('Connector listed documents without an ACL; they are readable by nobody', {
      connectorId,
      unattributed,
    })
  }
}

/** Whether an automatic connector sync may begin from this persisted state. */
export function isConnectorRunnableStatus(status: string): boolean {
  return RUNNABLE_CONNECTOR_STATUSES.some((runnableStatus) => runnableStatus === status)
}

function calculateNextSyncTime(syncIntervalMinutes: number): Date | null {
  if (syncIntervalMinutes <= 0) return null
  const now = Date.now()
  const jitterMs = randomInt(0, Math.min(syncIntervalMinutes * 6_000, 300_000))
  return new Date(now + syncIntervalMinutes * 60_000 + jitterMs)
}

/** Options for a sync-log close. */
interface CompleteSyncLogOptions {
  /** Recorded on the row when the run is being closed as `failed`. */
  errorMessage?: string
  /**
   * Connector whose sync lock this run must still hold for the close to land.
   *
   * Only the success path passes it. A `completed` row is the one sync-log
   * state that is read back as evidence — {@link loadPreviousListingObservation}
   * selects `status = 'completed'` — so it must not outlive the connector
   * bookkeeping it corroborates. `failed` rows are never read that way, and both
   * failure paths legitimately close a run whose lock is already gone.
   */
  requireSyncLockOn?: string
}

/**
 * Matches the log row only while its run still holds the connector's sync lock.
 *
 * The row's own `status = 'started'` guard defers to the scheduler's sweep, but
 * the sweep is not the only writer that can strand a live run. The
 * knowledge-base-deleted writers clear the token unconditionally, a user pausing
 * a connector flips it out of `syncing`, and the reaper's reclaim and its
 * log-close are two statements that can commit apart. In each case the run's
 * terminal connector write is refused while its log row is still `started`, so an
 * unguarded close publishes a `completed` row for bookkeeping that was discarded.
 *
 * Reuses {@link stillHoldsSyncLock} rather than restating the predicate, so the
 * log row and the connector row are written under exactly the same condition and
 * cannot disagree. A refused close leaves the row `started`; the scheduler's
 * sync-log sweep drains it, and that sweep is deliberately not connector-scoped,
 * so it still closes the row on an archived connector the reclaim skips.
 */
function syncLogRunStillHoldsLock(connectorId: string, syncLogId: string) {
  return exists(
    db
      .select({ held: sql`1` })
      .from(knowledgeConnector)
      .where(stillHoldsSyncLock(connectorId, syncLogId))
  )
}

/**
 * Records a sync run's outcome on its log row.
 *
 * Guarded on `status = 'started'` so a run that outlives
 * {@link CONNECTOR_SYNC_STALE_LOCK_TTL_MS} cannot overwrite a row the
 * scheduler's stale sweep already closed. Without the guard the two writers
 * race and produce contradictory history: the sweep marks the row `failed`,
 * then the still-running sync reports `completed` on the same row.
 *
 * That guard alone is a no-op on the normal path — nothing else touches the row
 * between its `started` insert and this call — so it only bites once the sweep
 * has declared the run dead, and the sweep's verdict is the one that stands.
 * {@link CompleteSyncLogOptions.requireSyncLockOn} covers the writers that strand
 * a run without going through the sweep.
 *
 * Returns whether the close landed. False means this run no longer owns the
 * outcome it was about to publish.
 */
export async function completeSyncLog(
  syncLogId: string,
  status: 'completed' | 'failed',
  result: SyncResult,
  options: CompleteSyncLogOptions = {}
): Promise<boolean> {
  const { errorMessage, requireSyncLockOn } = options

  const closed = await db
    .update(knowledgeConnectorSyncLog)
    .set({
      status,
      completedAt: new Date(),
      ...(errorMessage != null && { errorMessage }),
      docsAdded: result.docsAdded,
      docsUpdated: result.docsUpdated,
      docsDeleted: result.docsDeleted,
      docsUnchanged: result.docsUnchanged,
      docsSkipped: result.docsSkipped,
      docsFailed: result.docsFailed,
    })
    .where(
      and(
        eq(knowledgeConnectorSyncLog.id, syncLogId),
        eq(knowledgeConnectorSyncLog.status, 'started'),
        ...(requireSyncLockOn != null
          ? [syncLogRunStillHoldsLock(requireSyncLockOn, syncLogId)]
          : [])
      )
    )
    .returning({ id: knowledgeConnectorSyncLog.id })

  return closed.length > 0
}

class SyncCompletionOwnershipLost extends Error {
  constructor() {
    super('Connector sync no longer owns its terminal state')
    this.name = 'SyncCompletionOwnershipLost'
  }
}

/**
 * Atomically publishes the completed log and connector terminal state.
 *
 * The knowledge base is locked first to match lifecycle mutations, then the
 * connector lock is verified under `FOR UPDATE`. A completed log can therefore
 * never become visible unless the matching connector state commits with it.
 */
export async function completeSuccessfulSync(
  connectorId: string,
  knowledgeBaseId: string,
  syncLogId: string,
  syncIntervalMinutes: number,
  result: SyncResult,
  reconciliationHoldNotice: string | null,
  contentPass?: {
    complete: boolean
    checkpoint: {
      unsafe: boolean
      contentFailures?: boolean
      startedAt: string
      listedCount: number
      incrementalSince?: string | null
    }
  }
): Promise<boolean> {
  try {
    return await db.transaction(async (tx) => {
      const [lockedKnowledgeBase] = await tx
        .select({ id: knowledgeBase.id })
        .from(knowledgeBase)
        .where(and(eq(knowledgeBase.id, knowledgeBaseId), isNull(knowledgeBase.deletedAt)))
        .for('update')
      if (!lockedKnowledgeBase) throw new SyncCompletionOwnershipLost()

      const [lockedConnector] = await tx
        .select({ id: knowledgeConnector.id })
        .from(knowledgeConnector)
        .where(stillHoldsSyncLock(connectorId, syncLogId))
        .for('update')
      if (!lockedConnector) throw new SyncCompletionOwnershipLost()

      /**
       * Self-healing invariant of workspace mode: a mode switch back from
       * members that was interrupted, or any other drift, leaves no document
       * of this connector hidden from the workspace once a sync completes.
       * Inside the completion transaction, after the lock is proven held, so a
       * reclaimed run cannot rewrite a connector that has since changed mode.
       */
      const restoredAcls = await restoreWorkspaceDocumentAcls(tx, connectorId)
      if (restoredAcls > 0) {
        logger.warn('Restored workspace access on connector documents that had drifted', {
          connectorId,
          restoredAcls,
        })
      }

      const [{ count: actualDocCount }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(document)
        .where(
          and(
            eq(document.connectorId, connectorId),
            eq(document.userExcluded, false),
            isNull(document.archivedAt),
            isNull(document.deletedAt)
          )
        )

      const now = new Date()
      const [closedLog] = await tx
        .update(knowledgeConnectorSyncLog)
        .set({
          status:
            contentPass &&
            (!contentPass.complete ||
              contentPass.checkpoint.unsafe ||
              contentPass.checkpoint.contentFailures)
              ? 'partial'
              : 'completed',
          completedAt: now,
          listedCount: contentPass?.complete
            ? contentPass.checkpoint.incrementalSince
              ? actualDocCount
              : contentPass.checkpoint.listedCount
            : null,
          docsAdded: result.docsAdded,
          docsUpdated: result.docsUpdated,
          docsDeleted: result.docsDeleted,
          docsUnchanged: result.docsUnchanged,
          docsSkipped: result.docsSkipped,
          docsFailed: result.docsFailed,
        })
        .where(
          and(
            eq(knowledgeConnectorSyncLog.id, syncLogId),
            eq(knowledgeConnectorSyncLog.status, 'started')
          )
        )
        .returning({ id: knowledgeConnectorSyncLog.id })
      if (!closedLog) throw new SyncCompletionOwnershipLost()

      const [writtenConnector] = await tx
        .update(knowledgeConnector)
        .set({
          ...buildSyncSuccessUpdate(
            now,
            actualDocCount,
            contentPass && !contentPass.complete ? now : calculateNextSyncTime(syncIntervalMinutes),
            reconciliationHoldNotice,
            result.docsFailed === 0 &&
              (!contentPass ||
                (contentPass.complete &&
                  !contentPass.checkpoint.unsafe &&
                  !contentPass.checkpoint.contentFailures))
          ),
          /** Restored above under this same lock, or hidden by the admin pass before the ACLs it wrote. */
          accessRewritePending: false,
          ...(contentPass?.complete ? { listingCheckpoint: null } : {}),
          ...(contentPass?.complete &&
          !contentPass.checkpoint.unsafe &&
          !contentPass.checkpoint.contentFailures &&
          result.docsFailed === 0
            ? { lastSyncAt: new Date(contentPass.checkpoint.startedAt) }
            : {}),
        })
        .where(stillHoldsSyncLock(connectorId, syncLogId))
        .returning({ id: knowledgeConnector.id })
      if (!writtenConnector) throw new SyncCompletionOwnershipLost()

      return true
    })
  } catch (error) {
    if (error instanceof SyncCompletionOwnershipLost) return false
    throw error
  }
}

/** Columns a terminal write may set. Both paths write a subset of the same set. */
type ConnectorTerminalUpdate = Partial<typeof knowledgeConnector.$inferInsert>

/**
 * The only way a sync run writes its terminal state onto the connector row.
 *
 * Callers pass their own values and never build a WHERE clause: the
 * {@link stillHoldsSyncLock} guard is applied here, so there is exactly one
 * place it can be removed from and a terminal path added later cannot forget
 * it. Returns whether the write landed — false means the run was reclaimed
 * mid-flight and its bookkeeping was discarded in favour of whoever took the
 * row.
 */
export async function writeTerminalConnectorState(
  connectorId: string,
  syncLockToken: string,
  values: ConnectorTerminalUpdate
): Promise<boolean> {
  const written = await db
    .update(knowledgeConnector)
    .set(values)
    .where(stillHoldsSyncLock(connectorId, syncLockToken))
    .returning({ id: knowledgeConnector.id })

  return written.length > 0
}

/**
 * Releases the sync lock on a connector that was archived out from under a
 * running sync.
 *
 * `ConnectorDeletedException`'s handler is a terminal exit that wrote nothing to
 * the connector row, leaving it `status = 'syncing'` with this run's token still
 * on it. Nothing else can clear that: the scheduler's reclaim requires
 * `isNull(archivedAt)` and `isNull(deletedAt)`, so the one writer able to correct
 * a stranded lock skips exactly the rows this path creates. Both other "the
 * target is gone" exits — the knowledge-base-deleted writers here and in the
 * dispatch queue — already release token and lease and make the transition
 * terminal; this makes the third behave the same way.
 *
 * Guarded on {@link holdsSyncLockToken} rather than {@link stillHoldsSyncLock}
 * for the same reason the heartbeat is: the connector being archived is the
 * precondition of this path, so requiring it to still be live would reject every
 * write this function exists to make. Ownership alone is enough — the token
 * proves the lock is this run's, so a replacement's lock can never be released.
 *
 * A no-op when the connector row was hard-deleted rather than archived, which is
 * what a user-initiated connector delete does: there is no row left to unwedge.
 */
async function releaseSyncLockOnDeletedConnector(
  connectorId: string,
  syncLogId: string
): Promise<void> {
  await db
    .update(knowledgeConnector)
    .set({
      status: 'error',
      nextSyncAt: null,
      lastSyncError: 'Connector deleted during sync',
      syncLockToken: null,
      syncLockLeaseAt: null,
      updatedAt: new Date(),
    })
    .where(holdsSyncLockToken(connectorId, syncLogId))
}

/**
 * Reported when a run loses its connector's lock mid-flight — either because a
 * heartbeat found the lock reclaimed, or because its terminal write matched no
 * rows. Its document writes still landed; only its connector-level bookkeeping
 * was discarded, in favour of whoever reclaimed the row.
 */
export const SUPERSEDED_SYNC_ERROR = 'sync_superseded'

/**
 * Marks a superseded run with typed control flow so provider diagnostics can
 * never collide with a lifecycle reason.
 */
export function markSyncSuperseded(result: SyncResult): SyncResult {
  return { ...result, skipReason: SUPERSEDED_SYNC_ERROR }
}

/**
 * The connector row a failed sync writes.
 *
 * Extracted for the same reason as {@link buildSyncSuccessUpdate}: this is the
 * path the auto-disable breaker runs through, so the threshold and the backoff
 * it applies need to be assertable without standing up the whole sync. The
 * in-process ladder here and the reaper's SQL ladder must agree — they are two
 * writers of one policy, both sourced from
 * {@link connectorFailureBackoffMinutes}. A validated provider retry delay is
 * an additional lower bound, capped at the same one-day ceiling: a short hint
 * cannot weaken the failure ladder, while an untrusted extreme value cannot
 * pin the connector indefinitely.
 */
export function buildSyncFailureUpdate(
  now: Date,
  previousFailures: number | null | undefined,
  errorMessage: string,
  retryAfterMs?: number
) {
  const failures = (previousFailures ?? 0) + 1
  const disabled = failures >= MAX_CONSECUTIVE_FAILURES
  const failureBackoffMs = connectorFailureBackoffMinutes(failures) * 60 * 1000
  const maximumBackoffMs = CONNECTOR_FAILURE_BACKOFF_CAP_MINUTES * 60 * 1000
  const providerBackoffMs =
    typeof retryAfterMs === 'number' && Number.isFinite(retryAfterMs) && retryAfterMs > 0
      ? Math.min(retryAfterMs, maximumBackoffMs)
      : 0

  return {
    status: (disabled ? 'disabled' : 'error') as 'disabled' | 'error',
    lastSyncError: disabled ? CONNECTOR_AUTO_DISABLED_ERROR : errorMessage,
    nextSyncAt: disabled
      ? null
      : new Date(now.getTime() + Math.max(failureBackoffMs, providerBackoffMs)),
    consecutiveFailures: failures,
    // Releases the lock so a stale token can never match a later run, and closes
    // its lease so the reaper is not left waiting out a TTL on a finished run.
    syncLockToken: null,
    syncLockLeaseAt: null,
    updatedAt: now,
  }
}

/**
 * The connector row written after a provider positively identifies throttling.
 *
 * Structured throttling is a transient quota or availability condition, so it
 * must not consume the breaker reserved for persistent connector failures. The
 * provider deadline remains authoritative, with a short post-deadline jitter
 * to avoid releasing every connector sharing the same quota window at once.
 * When the provider omits a usable deadline, the first rung of the ordinary
 * failure ladder provides a conservative fallback.
 */
export function buildSyncRateLimitUpdate(
  now: Date,
  previousFailures: number | null | undefined,
  errorMessage: string,
  retryAfterMs?: number
) {
  const maximumBackoffMs = CONNECTOR_FAILURE_BACKOFF_CAP_MINUTES * 60 * 1000
  const providerBackoffMs =
    typeof retryAfterMs === 'number' && Number.isFinite(retryAfterMs) && retryAfterMs > 0
      ? retryAfterMs
      : connectorFailureBackoffMinutes(1) * 60 * 1000
  const jitterMs = randomInt(0, RATE_LIMIT_RETRY_JITTER_MAX_MS + 1)

  return {
    status: 'error' as const,
    lastSyncError: errorMessage,
    nextSyncAt: new Date(now.getTime() + Math.min(providerBackoffMs + jitterMs, maximumBackoffMs)),
    consecutiveFailures: previousFailures ?? 0,
    syncLockToken: null,
    syncLockLeaseAt: null,
    updatedAt: now,
  }
}

/**
 * A deterministic capacity rejection needs operator action, not an automatic
 * retry or the transient-failure circuit breaker. Keep its precise diagnostic,
 * release the lock, and leave the connector manually runnable.
 */
export function buildSyncCapacityUpdate(
  now: Date,
  previousFailures: number | null | undefined,
  errorMessage: string
) {
  return {
    status: 'error' as const,
    lastSyncError: errorMessage,
    nextSyncAt: null,
    consecutiveFailures: previousFailures ?? 0,
    syncLockToken: null,
    syncLockLeaseAt: null,
    updatedAt: now,
  }
}

/**
 * The connector row a successful sync writes.
 *
 * `holdNotice` is threaded through rather than written when the hold is detected
 * because this update runs at the very end of the sync and would otherwise clear
 * `lastSyncError` in the same run. `status` stays `active` and
 * `consecutiveFailures` still resets: a held pass is a healthy sync that declined
 * to delete, not a failure, and marking it broken would stop it syncing at all.
 */
export function buildSyncSuccessUpdate(
  now: Date,
  actualDocCount: number,
  nextSyncAt: Date | null,
  holdNotice: string | null,
  advanceLastSyncAt = true
) {
  return {
    status: 'active' as const,
    ...(advanceLastSyncAt ? { lastSyncAt: now } : {}),
    lastSyncError: holdNotice,
    lastSyncDocCount: actualDocCount,
    nextSyncAt,
    consecutiveFailures: 0,
    // Releases the lock so a stale token can never match a later run, and closes
    // its lease so the reaper is not left waiting out a TTL on a finished run.
    syncLockToken: null,
    syncLockLeaseAt: null,
    updatedAt: now,
  }
}

/**
 * Resolves the token a connector syncs with, failing loudly where the shared
 * resolver reports "no token" — a sync has no reconnect prompt to fall back to.
 */
async function resolveAccessToken(
  connector: { credentialId: string | null; encryptedApiKey: string | null },
  connectorConfig: { auth: ConnectorAuthConfig },
  userId: string,
  sourceConfig: Record<string, unknown>
): Promise<ConnectorAccessToken> {
  const requestId = `sync-${connector.credentialId}`
  const resolved = await resolveConnectorAccessToken({
    auth: connectorConfig.auth,
    connector,
    userId,
    requestId,
    sourceConfig,
  })

  if (!resolved) {
    logger.error(`[${requestId}] Connector credential resolved no access token`, {
      credentialId: connector.credentialId,
      userId,
      authMode: connectorConfig.auth.mode,
    })
    throw new Error(`Failed to obtain access token for credential ${connector.credentialId}`)
  }

  return resolved
}

/**
 * Execute a sync for a given knowledge connector.
 *
 * This is the core sync algorithm — connector-agnostic.
 * It looks up the ConnectorConfig from the registry and runs the shared sync
 * stages under the connector's content-sync lease.
 */
export async function executeSync(
  connectorId: string,
  options: {
    billingAttribution: BillingAttributionSnapshot
    fullSync?: boolean
    requireRunnable?: boolean
    rehydrate?: boolean
    /**
     * The queue entry this run is allowed to consume. Absent only for tasks
     * queued before the token existed; see {@link ConnectorSyncPayload}.
     */
    dispatchToken?: string
  }
): Promise<SyncResult> {
  const billingAttribution = assertBillingAttributionSnapshot(options?.billingAttribution)
  const result: SyncResult = {
    docsAdded: 0,
    docsUpdated: 0,
    docsDeleted: 0,
    docsUnchanged: 0,
    docsSkipped: 0,
    docsFailed: 0,
    processingDispatch: {
      requested: 0,
      accepted: 0,
      failed: 0,
    },
  }

  const connectorRows = await db
    .select()
    .from(knowledgeConnector)
    .where(
      and(
        eq(knowledgeConnector.id, connectorId),
        isNull(knowledgeConnector.archivedAt),
        isNull(knowledgeConnector.deletedAt)
      )
    )
    .limit(1)

  if (connectorRows.length === 0) {
    logger.warn(`Skipping sync: connector ${connectorId} not found, archived, or deleted`)
    return { ...result, skipReason: 'connector_unavailable' }
  }

  const connectorBeforeLock = connectorRows[0]

  /**
   * A connector that crawls per member is driven by the member engine, whose
   * lease is mutually exclusive with this one. Refused before any write so a
   * stale queue entry can never run a workspace-wide crawl over it.
   */
  if (!isContentEngineAccessMode(connectorBeforeLock.accessMode)) {
    logger.info('Skipping sync: connector is not driven by the content engine', {
      connectorId,
      accessMode: connectorBeforeLock.accessMode,
    })
    return { ...result, skipReason: 'connector_not_syncable' }
  }

  const connectorConfig = CONNECTOR_REGISTRY[connectorBeforeLock.connectorType]
  if (!connectorConfig) {
    throw new Error(`Unknown connector type: ${connectorBeforeLock.connectorType}`)
  }

  const kbRows = await db
    .select({
      userId: knowledgeBase.userId,
      workspaceId: knowledgeBase.workspaceId,
      organizationId: knowledgeBase.organizationId,
    })
    .from(knowledgeBase)
    .where(
      and(
        eq(knowledgeBase.id, connectorBeforeLock.knowledgeBaseId),
        isNull(knowledgeBase.deletedAt)
      )
    )
    .limit(1)

  if (kbRows.length === 0) {
    logger.warn(
      `Skipping sync: knowledge base ${connectorBeforeLock.knowledgeBaseId} is deleted (connector ${connectorId})`
    )
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
    return { ...result, skipReason: 'knowledge_base_deleted' }
  }

  const userId = kbRows[0].userId
  // Resolved once per sync and threaded into add/updateDocument so every synced
  // kb/ object records a trusted ownership binding without an N+1 KB lookup.
  const kbOwner: KnowledgeBaseOwner = {
    workspaceId: kbRows[0].workspaceId,
    organizationId: kbRows[0].organizationId,
    userId,
  }
  if (!kbOwner.workspaceId && !kbOwner.organizationId) {
    throw new Error(
      `Knowledge base ${connectorBeforeLock.knowledgeBaseId} is missing workspace billing context`
    )
  }
  assertBillingAttributionOwner(billingAttribution, kbOwner)
  /**
   * Identifies this run for the terminal writes. Generated before the CAS and
   * written by it, so ownership is established atomically with the lock — and
   * reused as the sync-log row id, which makes the connector row point at the
   * run that holds it.
   */
  const syncLogId = generateId()

  const lockResult = await db
    .update(knowledgeConnector)
    .set(buildSyncLockAcquisition(syncLogId, new Date()))
    .where(
      and(
        inArray(knowledgeConnector.accessMode, CONTENT_ENGINE_ACCESS_MODES),
        eq(knowledgeConnector.id, connectorId),
        inArray(knowledgeConnector.status, LOCKABLE_CONNECTOR_STATUSES),
        /**
         * Proves this run is consuming the queue entry that was made for it.
         *
         * A task delayed past the lease is reclaimed and replaced, and the
         * status check alone would let that stale task take the replacement's
         * entry — running superseded options (a plain sync where the user had
         * just asked for a full resync) while the replacement is turned away as
         * `sync_in_progress`. Matching the token is the same discipline
         * {@link holdsSyncLockToken} already applies to the `syncing` phase,
         * extended to the phase before it.
         */
        ...(options.dispatchToken
          ? [eq(knowledgeConnector.syncLockToken, options.dispatchToken)]
          : []),
        isNull(knowledgeConnector.archivedAt),
        isNull(knowledgeConnector.deletedAt)
      )
    )
    .returning()

  if (lockResult.length === 0) {
    /**
     * Distinguishes the two ways the CAS can find no row. Costs one read on a
     * path that already decided not to work, and the alternative is reporting a
     * connector someone paused as a concurrency conflict.
     */
    const [current] = await db
      .select({
        status: knowledgeConnector.status,
        syncLockToken: knowledgeConnector.syncLockToken,
      })
      .from(knowledgeConnector)
      .where(eq(knowledgeConnector.id, connectorId))
      .limit(1)

    /**
     * Status is checked before ownership because pausing a queued connector
     * releases its token, so a mismatch is the *symptom* there and the status is
     * the actual reason. Testing ownership first would report every
     * pause-while-queued — the common case — as a superseded dispatch, losing
     * the distinction this branch exists to draw.
     */
    if (current?.status === 'paused' || current?.status === 'disabled') {
      logger.info('Connector is not accepting syncs, skipping', {
        connectorId,
        status: current.status,
      })
      return { ...result, skipReason: 'connector_not_syncable' }
    }

    if (options.dispatchToken && current?.syncLockToken !== options.dispatchToken) {
      logger.info('Sync superseded by a newer dispatch, skipping', { connectorId })
      return { ...result, skipReason: 'dispatch_superseded' }
    }

    logger.info('Sync already in progress, skipping', { connectorId })
    return { ...result, skipReason: 'sync_in_progress' }
  }

  /**
   * The row returned by the lock is the authoritative sync snapshot. A source update
   * committed before the lock is included here; one attempted after it sees `syncing`
   * and conflicts instead of letting this worker process stale configuration.
   */
  const connector = lockResult[0]
  /** The lock CAS only takes a content-engine row; this is the type's word for the same fact. */
  if (!isContentEngineAccessMode(connector.accessMode)) {
    throw new Error(`Connector ${connectorId} left the content engine's modes while locked`)
  }
  const mirrored = mirrorsSourceAcls(connector.accessMode)
  const sourceConfig = connector.sourceConfig as Record<string, unknown>
  const syncStartedAt = new Date()
  const lease = createContentSyncLease(connectorId, syncLogId)
  await db.insert(knowledgeConnectorSyncLog).values({
    id: syncLogId,
    connectorId,
    status: 'started',
    startedAt: syncStartedAt,
  })

  try {
    /**
     * OAuth credentials are workspace-scoped and shared, so the member who authorized
     * one is often not the knowledge base owner. Resolve the credential's own account
     * owner — token reads are scoped to `account.userId`, so passing the KB owner
     * resolves no token at all. Resolved once here rather than inside
     * `resolveAccessToken` so per-page refreshes don't repeat the lookup.
     */
    const credentialUserId = await resolveConnectorTokenUserId({
      credentialId: connector.credentialId,
      ...resourceScopeFields(resourceScopeFromOwner(kbOwner)),
      fallbackUserId: userId,
    })
    if (!credentialUserId) {
      throw new Error(
        `Credential ${connector.credentialId} is not usable from workspace ${kbOwner.workspaceId} — reconnect the credential`
      )
    }

    let credentialToken = await resolveAccessToken(
      connector,
      connectorConfig,
      credentialUserId,
      sourceConfig
    )
    /** Re-resolves the token for every OAuth call after the first, so a long run outlives a short-lived token. */
    const refreshOAuthToken = async (): Promise<void> => {
      if (connectorConfig.auth.mode === 'oauth') {
        credentialToken = await resolveAccessToken(
          connector,
          connectorConfig,
          credentialUserId,
          sourceConfig
        )
      }
    }

    /**
     * A credential that already knows its cloud id seeds the same `syncContext`
     * slot the connector would otherwise memoise it into. Confluence discovers
     * it by calling `accessible-resources` with a bearer token; an Atlassian
     * service account holds an API token that cannot make that call, so for it
     * the seed is the only source. Connectors need no service-account branch.
     */
    const syncContext: Record<string, unknown> = {
      syncRunId: generateId(),
      ...syncContextForToken(credentialToken),
      /** Tells a connector to carry permissions with its listing; without it, none are read. */
      ...(mirrored ? { mirrorsSourceAcls: true } : {}),
    }

    // Shared cutoff for both the tombstone-retry bound below and the stuck-document
    // retry near the end of this sync — same RETRY_WINDOW_DAYS window, one computation.
    const retryCutoff = new Date(Date.now() - RETRY_WINDOW_DAYS * 24 * 60 * 60 * 1000)

    /**
     * Bounded to the same retry window as the stuck-document retry below: a
     * document whose refresh keeps failing every sync (e.g. permanently
     * oversized) would otherwise be a tombstone that never resolves, forcing a
     * full listing — and its listing-time overhead — for this connector
     * forever. Past the window, this connector stops forcing full syncs on its
     * account; the document itself is unaffected and stays tombstoned either way.
     *
     * Known accepted trade-off: once past the window, a still-tombstoned
     * document that's unchanged-but-genuinely-present at the source can only
     * be resurrected by a full listing — and nothing here forces one anymore.
     * On a connector that never runs a full sync again (persistent incremental
     * syncMode, no manual full resync), that document stays correctly
     * invisible (excluded everywhere by `isNull(deletedAt)`, so no
     * search/billing/listing leakage) but unresolved indefinitely. This is
     * deliberately not "fixed" by hard-deleting it after the window expires —
     * that would delete a document we have no positive evidence is actually
     * gone, reintroducing the exact risk this whole design exists to avoid.
     */
    const hasTombstonedDocs = await db
      .select({ id: document.id })
      .from(document)
      .where(
        and(
          eq(document.connectorId, connectorId),
          isNull(document.archivedAt),
          or(
            and(isNotNull(document.deletedAt), gt(document.deletedAt, retryCutoff)),
            isNull(document.contentHash)
          )
        )
      )
      .limit(1)
      .then((rows) => rows.length > 0)

    /**
     * Determine if this sync should be incremental. A `rehydrate` request forces a
     * full listing too: re-hydration must see *every* document (a container page can
     * be unchanged itself yet transclude a page that changed), and an incremental
     * listing would omit those unchanged containers, so they'd never be re-fetched.
     */
    const isIncremental =
      !mirrored &&
      shouldRunIncrementalSync(
        connectorConfig.supportsIncrementalSync,
        connector.syncMode,
        options?.fullSync,
        options?.rehydrate,
        hasTombstonedDocs,
        connector.lastSyncAt
      )
    const lastSyncAt =
      isIncremental && connector.lastSyncAt ? new Date(connector.lastSyncAt) : undefined

    /**
     * Re-hydrate and re-index connectors whose rendered content can drift without a
     * hash change (transclusions) — see `ConnectorMeta.rehydrateOnFullSync`. Driven
     * by the dedicated `rehydrate` request (the "Full resync" action) or implied by a
     * true `fullSync`. It forces a full listing (above) and re-indexes unchanged
     * deferred docs, but — unlike `fullSync` — it does NOT bypass any
     * deletion-reconciliation safety guard. Incremental syncs of other connectors
     * stay hash-gated.
     */
    const forceRehydrate = Boolean(
      (options?.rehydrate || options?.fullSync) && connectorConfig.rehydrateOnFullSync
    )

    let directoryRefreshed: Promise<Error | undefined> = Promise.resolve(undefined)
    if (mirrored) {
      /**
       * A switch into this mode hides every document before it flips, and one
       * whose rewrite outgrew its request budget leaves the rest for the next
       * run. It has to be finished *before this run lists anything*: the
       * documents it did not reach are still readable by the whole workspace,
       * and the completion write below clears the flag on the strength of this
       * pass having left none under the mode the connector came from. The
       * workspace-mode equivalent runs at completion instead, because restoring
       * is safe to do last; hiding is not.
       */
      if (connector.accessRewritePending) {
        await rewriteConnectorAcls(connectorId, EMPTY_ACL, {
          beforeBatch: lease.beatIfDue,
          lease,
        })
      }
      /**
       * Started before the listing and awaited before the ACLs are written: a
       * group grant this crawl writes must never point at membership nobody
       * has read, and the scheduler's refresh is a cadence, not a guarantee.
       * Observe failures immediately while allowing content ingestion to finish.
       * The terminal sync write below still reports directory failures.
       */
      directoryRefreshed = refreshMirroredDirectory({
        ...resourceScopeFields(resourceScopeFromOwner(kbOwner)),
        connectorConfig,
        sourceConfig,
        syncContext,
        accessToken: credentialToken.accessToken,
        force:
          Boolean(options.fullSync) ||
          connector.consecutiveFailures > 0 ||
          connector.lastSyncError?.startsWith(DIRECTORY_ERROR_PREFIX),
      }).then(() => undefined, toError)
    }

    const contentPass = await runConnectorContentPass({
      connectorId,
      connector,
      connectorConfig,
      sourceConfig,
      syncContext,
      lastSyncAt,
      kbOwner,
      billingAttribution,
      result,
      forceRehydrate,
      getAccessToken: async (pageNum) => {
        if (pageNum > 0) await refreshOAuthToken()
        return credentialToken.accessToken
      },
      hydration: {
        beforeHydration: refreshOAuthToken,
        getDocument: (externalId) =>
          connectorConfig.getDocument(
            credentialToken.accessToken,
            sourceConfig,
            externalId,
            syncContext
          ),
      },
      lease,
      documentAccess: connector.accessMode,
      runId: syncLogId,
      leaseKind: 'content',
      fingerprint: listingFingerprint({
        connectorType: connector.connectorType,
        credentialId: connector.credentialId,
        encryptedApiKey: connector.encryptedApiKey,
        sourceConfig,
        accessMode: connector.accessMode,
      }),
      fullSync: options.fullSync,
      deadlineAt: syncStartedAt.getTime() + (CONNECTOR_SYNC_MAX_DURATION_SECONDS - 300) * 1000,
      onPage: mirrored
        ? async (externalDocs) => {
            await directoryRefreshed
            await applySourceMirroredAcls({
              connectorId,
              connectorConfig,
              sourceConfig,
              syncContext,
              accessToken: credentialToken.accessToken,
              externalDocs,
              ownedExternalIds: [],
              lease,
            })
          }
        : undefined,
    })

    result.listingIncomplete =
      !contentPass.complete ||
      contentPass.checkpoint.unsafe ||
      contentPass.checkpoint.contentFailures
    const reconciliationHoldNotice = contentPass.holdNotice
    const directoryError = await directoryRefreshed
    if (directoryError) throw directoryError

    const postBatchPresence = await checkSyncTargetPresence(connectorId, connector.knowledgeBaseId)
    if (postBatchPresence.connectorDeleted) {
      throw new ConnectorDeletedException(connectorId)
    }
    if (postBatchPresence.knowledgeBaseDeleted) {
      throw new Error(`Knowledge base ${connector.knowledgeBaseId} was deleted during sync`)
    }

    await sweepStuckDocuments({
      connectorId,
      knowledgeBaseId: connector.knowledgeBaseId,
      syncStartedAt,
      retryCutoff,
      billingAttribution,
      result,
      lease,
    })

    const completionLanded = await completeSuccessfulSync(
      connectorId,
      connector.knowledgeBaseId,
      syncLogId,
      effectiveConnectorSyncIntervalMinutes(connector.accessMode, connector.syncIntervalMinutes),
      result,
      reconciliationHoldNotice,
      contentPass
    )

    if (!completionLanded) {
      logger.warn('Sync result discarded — connector was reclaimed while this run was executing', {
        connectorId,
        syncLogId,
        ...result,
      })
      return markSyncSuperseded(result)
    }

    logger.info('Sync completed', { connectorId, ...result })
    return result
  } catch (error) {
    let connectorDeleted = error instanceof ConnectorDeletedException
    if (error instanceof SyncLockLostException) {
      /** A checkpoint can discover an archive before the next batch's presence check. */
      const [ownedArchive] = await db
        .select({
          archivedAt: knowledgeConnector.archivedAt,
          deletedAt: knowledgeConnector.deletedAt,
        })
        .from(knowledgeConnector)
        .where(
          and(
            holdsSyncLockToken(connectorId, syncLogId),
            or(isNotNull(knowledgeConnector.archivedAt), isNotNull(knowledgeConnector.deletedAt))
          )
        )
        .limit(1)
      connectorDeleted = Boolean(ownedArchive?.archivedAt || ownedArchive?.deletedAt)
      if (!connectorDeleted) {
        /** A replacement-owned connector must receive no writes from this run. */
        logger.warn('Sync abandoned — lock was reclaimed while this run was executing', {
          connectorId,
          syncLogId,
          ...result,
        })
        return markSyncSuperseded(result)
      }
    }

    if (connectorDeleted) {
      logger.info('Connector deleted during sync, cleaning up', { connectorId })

      try {
        await releaseSyncLockOnDeletedConnector(connectorId, syncLogId)

        /**
         * Includes pending-removal tombstones. Page IDs so deleting a connector
         * with a legacy corpus above the sync admission cap cannot materialize
         * the entire corpus in the cleanup worker.
         */
        let afterDocumentId: string | undefined
        while (true) {
          const connectorDocs = await db
            .select({ id: document.id })
            .from(document)
            .where(
              and(
                eq(document.connectorId, connectorId),
                isNull(document.archivedAt),
                afterDocumentId ? gt(document.id, afterDocumentId) : undefined
              )
            )
            .orderBy(asc(document.id))
            .limit(CONNECTOR_DELETION_CLEANUP_BATCH_SIZE)
          if (connectorDocs.length === 0) break

          await hardDeleteDocuments(
            connectorDocs.map((doc) => doc.id),
            syncLogId,
            connectorId
          )
          afterDocumentId = connectorDocs.at(-1)?.id
          if (connectorDocs.length < CONNECTOR_DELETION_CLEANUP_BATCH_SIZE) break
        }

        await completeSyncLog(syncLogId, 'failed', result, {
          errorMessage: 'Connector deleted during sync',
        })
      } catch (cleanupError) {
        logger.error('Failed to clean up after connector deletion', {
          connectorId,
          error: toError(cleanupError).message,
        })
      }

      result.skipReason = 'connector_deleted_during_sync'
      return result
    }

    const errorMessage = toError(error).message
    const retryAfterMs = getRetryAfterMs(error)
    const rateLimited = isRateLimitError(error)
    logger.error('Sync failed', {
      connectorId,
      error: errorMessage,
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    })

    try {
      await completeSyncLog(syncLogId, 'failed', result, { errorMessage })

      const failureUpdate =
        error instanceof ConnectorSyncCapacityError
          ? buildSyncCapacityUpdate(new Date(), connector.consecutiveFailures, errorMessage)
          : rateLimited
            ? buildSyncRateLimitUpdate(
                new Date(),
                connector.consecutiveFailures,
                errorMessage,
                retryAfterMs
              )
            : buildSyncFailureUpdate(
                new Date(),
                connector.consecutiveFailures,
                errorMessage,
                retryAfterMs
              )

      if (failureUpdate.status === 'disabled') {
        logger.warn('Connector disabled after repeated failures', {
          connectorId,
          consecutiveFailures: failureUpdate.consecutiveFailures,
        })
      }

      const failureWriteLanded = await writeTerminalConnectorState(
        connectorId,
        syncLogId,
        failureUpdate
      )

      /**
       * Deliberately does NOT get {@link markSyncSuperseded}. `result.error`
       * is set to the real failure cause below, so replacing it with lifecycle
       * control flow would destroy the diagnostic. The supersession is carried
       * by this log line instead.
       */
      if (!failureWriteLanded) {
        logger.warn(
          'Sync failure discarded — connector was reclaimed while this run was executing',
          { connectorId, syncLogId, error: errorMessage }
        )
      }
    } catch (recoveryError) {
      logger.error('Failed to record sync failure', {
        connectorId,
        error: toError(recoveryError).message,
      })
    }

    result.error = errorMessage
    return result
  }
}
