import { db } from '@sim/db'
import { knowledgeBase, knowledgeConnector, knowledgeConnectorSyncLog } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, asc, eq, inArray, isNull, lte, type SQL, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/auth/internal'
import { resolveSystemBillingAttribution } from '@/lib/billing/core/billing-attribution'
import { mapWithConcurrency } from '@/lib/core/utils/concurrency'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { dispatchSync } from '@/lib/knowledge/connectors/queue'
import {
  CONNECTOR_FAILURE_BACKOFF_CAP_MINUTES,
  CONNECTOR_FAILURE_BACKOFF_STEP_MINUTES,
  CONNECTOR_SYNC_STALE_LOCK_TTL_MS,
  MAX_CONSECUTIVE_FAILURES,
} from '@/lib/knowledge/connectors/sync-limits'

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

    const recoveredConnectors = await db
      .update(knowledgeConnector)
      .set({
        status: reclaimedStatus(),
        lastSyncError: STALE_LOCK_ERROR_MESSAGE,
        nextSyncAt: reclaimedNextSyncAt(),
        consecutiveFailures: reclaimedFailureCount(),
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(knowledgeConnector.status, 'syncing'),
          lte(knowledgeConnector.updatedAt, staleCutoff),
          isNull(knowledgeConnector.archivedAt),
          isNull(knowledgeConnector.deletedAt)
        )
      )
      .returning({ id: knowledgeConnector.id })

    if (recoveredConnectors.length > 0) {
      logger.warn(
        `[${requestId}] Recovered ${recoveredConnectors.length} stale syncing connectors`,
        { ids: recoveredConnectors.map((c) => c.id) }
      )
    }

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
     * Safe on liveness: the run ceiling is
     * {@link CONNECTOR_SYNC_MAX_DURATION_SECONDS} and this TTL is twice that, so
     * a row older than the cutoff belongs to a run the platform has already
     * killed and which cannot still be writing. The predicate is per-row on
     * `startedAt`, so a fresh run's log row can never be caught by it — even on
     * a connector whose previous run is being reclaimed in this same tick.
     */
    const closedSyncLogs = await db
      .update(knowledgeConnectorSyncLog)
      .set({
        status: 'failed',
        completedAt: sql`now()`,
        errorMessage: STALE_LOCK_ERROR_MESSAGE,
      })
      .where(
        and(
          eq(knowledgeConnectorSyncLog.status, 'started'),
          lte(knowledgeConnectorSyncLog.startedAt, staleCutoff)
        )
      )
      .returning({ id: knowledgeConnectorSyncLog.id })

    if (closedSyncLogs.length > 0) {
      logger.warn(`[${requestId}] Closed ${closedSyncLogs.length} orphaned connector sync log(s)`)
    }

    const dueConnectors = await db
      .select({
        id: knowledgeConnector.id,
        workspaceId: knowledgeBase.workspaceId,
      })
      .from(knowledgeConnector)
      .innerJoin(knowledgeBase, eq(knowledgeConnector.knowledgeBaseId, knowledgeBase.id))
      .where(
        and(
          inArray(knowledgeConnector.status, ['active', 'error']),
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
        if (!connector.workspaceId) {
          throw new Error(`Connector ${connector.id} is missing workspace billing context`)
        }
        const billingAttribution = await resolveSystemBillingAttribution(connector.workspaceId)
        await dispatchSync(connector.id, { billingAttribution, requestId })
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
