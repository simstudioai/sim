import { db } from '@sim/db'
import { knowledgeBase, knowledgeConnector, knowledgeConnectorSyncLog } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, asc, eq, inArray, isNull, lte, type SQL, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/auth/internal'
import {
  resolveSystemBillingAttribution,
  resolveSystemOrganizationBillingAttribution,
} from '@/lib/billing/core/billing-attribution'
import { resourceScopeFromOwner } from '@/lib/core/resource-scope'
import { mapWithConcurrency } from '@/lib/core/utils/concurrency'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { CONTENT_ENGINE_ACCESS_MODES } from '@/lib/knowledge/connectors/access-modes'
import { dispatchSync } from '@/lib/knowledge/connectors/queue'
import {
  CONNECTOR_AUTO_DISABLED_ERROR,
  CONNECTOR_FAILURE_BACKOFF_CAP_MINUTES,
  CONNECTOR_FAILURE_BACKOFF_STEP_MINUTES,
  CONNECTOR_SYNC_STALE_LOCK_TTL_MS,
  MAX_CONSECUTIVE_FAILURES,
} from '@/lib/knowledge/connectors/sync-limits'
import { RUNNABLE_CONNECTOR_STATUSES } from '@/lib/knowledge/connectors/sync-lock'

export const dynamic = 'force-dynamic'

const logger = createLogger('ConnectorSyncSchedulerAPI')

/**
 * Per-tick cap on sync dispatches. Ordered by oldest `nextSyncAt` first so
 * connectors beyond the cap are picked up by the next tick, not starved.
 */
const MAX_DISPATCHES_PER_TICK = 200

/** Each dispatch does a joined SELECT + conditional UPDATE against the shared pool. */
const DISPATCH_CONCURRENCY = 10

const STALE_LOCK_ERROR_MESSAGE = 'Sync timed out (stale lock recovered)'

/**
 * A connector left `pending` past the TTL — its sync was queued but no worker
 * ever took the lock, so the hand-off was lost (the process died between the
 * two writes, or the queued run was dropped). Distinct from the stale-lock
 * message because nothing timed out: the sync never started.
 */
const LOST_DISPATCH_ERROR_MESSAGE = 'Sync was queued but never started'

/**
 * How long the connector holding the lock has gone without proving it is alive.
 *
 * `sync_lock_lease_at` is written only by lock acquisition and the heartbeat, so
 * it is the lease; `updated_at` is the row's modification time and merely used
 * to double as one. Read through `COALESCE` rather than backfilled: a plain
 * `lease <= cutoff` is NULL-false, so a row already `syncing` when this column
 * shipped would never be reclaimed — strictly worse than the behaviour it
 * replaces. The fallback also keeps the reaper correct against any future
 * writer that takes the lock without opening a lease.
 */
function syncLockLease(): SQL {
  return sql`COALESCE(${knowledgeConnector.syncLockLeaseAt}, ${knowledgeConnector.updatedAt})`
}

/**
 * The error a reclaimed connector reports.
 *
 * Mirrors {@link reclaimedStatus}: once the reclaim disables the connector,
 * {@link reclaimedNextSyncAt} sets no next attempt, so telling the operator the
 * sync merely timed out describes a retry that will never happen. The disabled
 * wording is the shared one `buildSyncFailureUpdate` writes, so the in-process
 * breaker and this SQL breaker cannot drift into two different messages for one
 * verdict.
 */
function reclaimedError(message: string): SQL {
  return sql`CASE WHEN COALESCE(${knowledgeConnector.consecutiveFailures}, 0) + 1 >= ${MAX_CONSECUTIVE_FAILURES} THEN ${CONNECTOR_AUTO_DISABLED_ERROR} ELSE ${message} END`
}

/**
 * Excludes a sync-log row belonging to a run that is demonstrably still alive.
 *
 * The sweep keys on `startedAt`, and nothing refreshes that — the heartbeat
 * renews `knowledge_connector.updatedAt`, and the log table has no equivalent
 * column. So a legitimately long in-process run keeps its connector lock but
 * would still have its log row closed as `failed` at the TTL, recording a
 * successful sync as a failure and losing its counters to
 * `loadPreviousListingObservation`, which reads only `completed` rows.
 *
 * The heartbeat is the single source of liveness truth, so this defers to it,
 * reading the same {@link syncLockLease} expression the reclaim predicate does.
 * Sparing requires all three of: the connector is locked, THIS row's run is the
 * lock holder, and that lock is being heartbeated. An orphan can satisfy at most
 * two, so none is ever stranded:
 * - reclaimed after a hard kill — connector is `error`, token cleared;
 * - a replacement holds the lock — the token is the successor's, not this row's;
 * - died without being reclaimed, including on an archived or deleted connector
 *   the reclaim skips entirely — its lease is stale.
 *
 * This re-references the connector row, which an earlier fix deliberately moved
 * away from. That coupling was different: it restricted the sweep's candidate
 * set to *this tick's reclaims*, which made a pre-existing backlog undrainable.
 * This is a per-row liveness predicate — every stale row is still a candidate,
 * so the sweep stays self-healing.
 */
function logRowNotHeldByLiveRun(staleCutoff: Date): SQL {
  return sql`NOT EXISTS (
    SELECT 1 FROM ${knowledgeConnector}
    WHERE ${knowledgeConnector.id} = ${knowledgeConnectorSyncLog.connectorId}
      AND ${knowledgeConnector.syncLockToken} = ${knowledgeConnectorSyncLog.id}
      AND ${knowledgeConnector.status} = 'syncing'
      AND ${syncLockLease()} > ${sql.param(staleCutoff, knowledgeConnector.syncLockLeaseAt)}
  )`
}

/**
 * The reclaimed connector's new consecutive-failure count.
 *
 * A hard kill (OOM/SIGKILL) skips `executeSync`'s `catch` and `finally`
 * entirely, so this reaper is the ONLY writer that ever observes that failure.
 * Computed in SQL rather than read-then-written because two overlapping cron
 * ticks reclaiming the same row would otherwise both read the same value and
 * write the same increment, losing one.
 */
function reclaimedFailureCount(): SQL {
  return sql`COALESCE(${knowledgeConnector.consecutiveFailures}, 0) + 1`
}

/** Disables the connector once the reclaimed count reaches the shared threshold. */
function reclaimedStatus(): SQL {
  return sql`CASE WHEN COALESCE(${knowledgeConnector.consecutiveFailures}, 0) + 1 >= ${MAX_CONSECUTIVE_FAILURES} THEN 'disabled' ELSE 'error' END`
}

/**
 * The reclaimed connector's next attempt, on the shared failure ladder
 * (`connectorFailureBackoffMinutes`). A disabled connector gets no next attempt.
 */
function reclaimedNextSyncAt(): SQL {
  return sql`CASE WHEN COALESCE(${knowledgeConnector.consecutiveFailures}, 0) + 1 >= ${MAX_CONSECUTIVE_FAILURES} THEN NULL ELSE now() + LEAST((COALESCE(${knowledgeConnector.consecutiveFailures}, 0) + 1) * ${CONNECTOR_FAILURE_BACKOFF_STEP_MINUTES}, ${CONNECTOR_FAILURE_BACKOFF_CAP_MINUTES}) * INTERVAL '1 minute' END`
}

/**
 * The write shared by both reclaims: a connector that stopped making progress
 * re-enters the failure ladder. Factored so the two callers cannot drift into
 * different ladders for the same verdict — the same reason
 * {@link reclaimedError} takes the message rather than hardcoding it.
 */
function reclaimPayload(message: string) {
  return {
    status: reclaimedStatus(),
    lastSyncError: reclaimedError(message),
    nextSyncAt: reclaimedNextSyncAt(),
    consecutiveFailures: reclaimedFailureCount(),
    updatedAt: sql`now()`,
  }
}

/**
 * Cron endpoint that checks for connectors due for sync and dispatches sync jobs.
 * Should be called every 5 minutes by an external cron service.
 */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()
  logger.info(`[${requestId}] Connector sync scheduler triggered`)

  const authError = verifyCronAuth(request, 'Connector sync scheduler')
  if (authError) {
    return authError
  }

  try {
    const now = new Date()

    const staleCutoff = new Date(now.getTime() - CONNECTOR_SYNC_STALE_LOCK_TTL_MS)

    /**
     * The three recovery passes target disjoint row sets — a held-but-silent
     * lock, a queue entry that never became one, and a sync-log row orphaned by
     * a killed run — and none reads another's result, so they go out together
     * rather than as three serialized round trips.
     *
     * `logRowNotHeldByLiveRun` is the one apparent coupling and it is benign:
     * it spares a log row only while its connector's lease is still live, and
     * every row the lock reclaim targets has an expired lease, so the sweep
     * reaches the same verdict against either snapshot.
     */
    const [recoveredConnectors, recoveredPendingConnectors, closedSyncLogs] = await Promise.all([
      db
        .update(knowledgeConnector)
        .set({
          ...reclaimPayload(STALE_LOCK_ERROR_MESSAGE),
          /**
           * Releases the reclaimed run's ownership token so its terminal write
           * can no longer match, even before a replacement takes the lock, and
           * closes its lease so a re-locked row starts from a fresh one.
           */
          syncLockToken: null,
          syncLockLeaseAt: null,
        })
        .where(
          and(
            eq(knowledgeConnector.status, 'syncing'),
            sql`${syncLockLease()} <= ${sql.param(staleCutoff, knowledgeConnector.syncLockLeaseAt)}`,
            isNull(knowledgeConnector.archivedAt),
            isNull(knowledgeConnector.deletedAt)
          )
        )
        .returning({ id: knowledgeConnector.id }),
      /**
       * Recovers connectors whose queued sync was never picked up.
       *
       * `pending` is written just before the hand-off to the queue, so a row that
       * is still `pending` past the TTL means no worker ever took the lock: the
       * process died between the two writes, or the queued run was dropped. Left
       * alone the connector would sit `pending` forever — the stale-lock reclaim
       * above only looks at `syncing` rows, and the due-sweep below only at
       * `active`/`error`.
       *
       * Flipped to `error` rather than straight back to `active` so it re-enters
       * through the same failure ladder as any other unsuccessful sync: repeated
       * lost dispatches back off and eventually disable, instead of re-queueing
       * every tick forever.
       *
       * Ages against {@link syncLockLease}, the same expression the stale-lock
       * pass reads, because `markSyncPending` opens the lease when it queues.
       * `updatedAt` would be wrong here for exactly the reason the lease column
       * exists: a `pending` connector is still editable, so every unrelated write
       * to the row would renew the recovery it is meant to trigger — a config
       * edit on a stuck connector could defer it forever.
       */
      db
        .update(knowledgeConnector)
        .set({
          ...reclaimPayload(LOST_DISPATCH_ERROR_MESSAGE),
          /** Releases the queue entry's token so a late hand-off cannot match it. */
          syncLockToken: null,
          syncLockLeaseAt: null,
        })
        .where(
          and(
            eq(knowledgeConnector.status, 'pending'),
            sql`${syncLockLease()} <= ${sql.param(staleCutoff, knowledgeConnector.syncLockLeaseAt)}`,
            isNull(knowledgeConnector.archivedAt),
            isNull(knowledgeConnector.deletedAt)
          )
        )
        .returning({ id: knowledgeConnector.id }),
      /**
       * Closes sync-log rows left `started` by a killed run. Nothing else ever
       * reconciles them, and `loadPreviousListingObservation` reads only
       * `completed` rows, so a never-closed run silently ages out the previous
       * observation it should have provided.
       *
       * Deliberately independent of this tick's reclaims rather than scoped to
       * them. A row orphaned before this shipped — or by a transient failure of
       * this very statement — belongs to a connector already flipped out of
       * `syncing`, so it would never appear in a future reclaim batch and would
       * stay stranded forever. Keying off the row's own `startedAt` instead makes
       * the sweep self-healing and lets it drain the existing backlog.
       *
       * Age alone does not prove a run is dead: the in-process fallback path has
       * no duration cap, so a large self-hosted sync can genuinely still be
       * working past the TTL. `logRowNotHeldByLiveRun` is what makes this safe —
       * a run whose lock is still being heartbeated is spared regardless of age.
       * The age predicate is also per-row on `startedAt`, so a fresh run's log row
       * can never be caught by it, even on a connector whose previous run is being
       * reclaimed in this same tick.
       */
      db
        .update(knowledgeConnectorSyncLog)
        .set({
          status: 'failed',
          completedAt: sql`now()`,
          errorMessage: STALE_LOCK_ERROR_MESSAGE,
        })
        .where(
          and(
            eq(knowledgeConnectorSyncLog.status, 'started'),
            lte(knowledgeConnectorSyncLog.startedAt, staleCutoff),
            logRowNotHeldByLiveRun(staleCutoff)
          )
        )
        .returning({ id: knowledgeConnectorSyncLog.id }),
    ])

    if (recoveredConnectors.length > 0) {
      logger.warn(
        `[${requestId}] Recovered ${recoveredConnectors.length} stale syncing connectors`,
        { ids: recoveredConnectors.map((c) => c.id) }
      )
    }

    if (recoveredPendingConnectors.length > 0) {
      logger.warn(
        `[${requestId}] Recovered ${recoveredPendingConnectors.length} connectors whose queued sync was never started`,
        { ids: recoveredPendingConnectors.map((c) => c.id) }
      )
    }

    if (closedSyncLogs.length > 0) {
      logger.warn(`[${requestId}] Closed ${closedSyncLogs.length} orphaned connector sync log(s)`)
    }

    const dueConnectors = await db
      .select({
        id: knowledgeConnector.id,
        nextSyncAt: knowledgeConnector.nextSyncAt,
        workspaceId: knowledgeBase.workspaceId,
        organizationId: knowledgeBase.organizationId,
      })
      .from(knowledgeConnector)
      .innerJoin(knowledgeBase, eq(knowledgeConnector.knowledgeBaseId, knowledgeBase.id))
      .where(
        and(
          inArray(knowledgeConnector.status, RUNNABLE_CONNECTOR_STATUSES),
          inArray(knowledgeConnector.accessMode, CONTENT_ENGINE_ACCESS_MODES),
          lte(knowledgeConnector.nextSyncAt, now),
          isNull(knowledgeConnector.archivedAt),
          isNull(knowledgeConnector.deletedAt),
          isNull(knowledgeBase.deletedAt)
        )
      )
      .orderBy(asc(knowledgeConnector.nextSyncAt))
      .limit(MAX_DISPATCHES_PER_TICK)

    logger.info(`[${requestId}] Found ${dueConnectors.length} connectors due for sync`)

    if (dueConnectors.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No connectors due for sync',
        count: 0,
      })
    }

    await mapWithConcurrency(dueConnectors, DISPATCH_CONCURRENCY, async (connector) => {
      try {
        const scope = resourceScopeFromOwner(connector)
        const billingAttribution =
          scope.kind === 'organization'
            ? await resolveSystemOrganizationBillingAttribution(scope.organizationId)
            : await resolveSystemBillingAttribution(scope.workspaceId)
        await dispatchSync(connector.id, {
          billingAttribution,
          expectedNextSyncAt: connector.nextSyncAt ?? undefined,
          requestId,
          requireRunnable: true,
        })
      } catch (error) {
        logger.error(`[${requestId}] Failed to dispatch sync for connector ${connector.id}`, error)
      }
    })

    return NextResponse.json({
      success: true,
      message: `Dispatched ${dueConnectors.length} connector sync(s)`,
      count: dueConnectors.length,
    })
  } catch (error) {
    logger.error(`[${requestId}] Connector sync scheduler error`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})
