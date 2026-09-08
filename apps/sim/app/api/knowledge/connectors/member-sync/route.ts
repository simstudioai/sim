import { db } from '@sim/db'
import { knowledgeBase, knowledgeConnector, knowledgeConnectorMemberSyncLog } from '@sim/db/schema'
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
import { sweepStaleMemberObservations } from '@/lib/knowledge/connectors/member-observations'
import {
  dispatchMemberSync,
  QUEUEABLE_MEMBER_SYNC_STATUSES,
} from '@/lib/knowledge/connectors/member-queue'
import {
  CONNECTOR_AUTO_DISABLED_ERROR,
  CONNECTOR_FAILURE_BACKOFF_CAP_MINUTES,
  CONNECTOR_FAILURE_BACKOFF_STEP_MINUTES,
  MAX_CONSECUTIVE_FAILURES,
  MEMBER_SYNC_STALE_LOCK_TTL_MS,
} from '@/lib/knowledge/connectors/sync-limits'
import { RUNNABLE_CONNECTOR_STATUSES } from '@/lib/knowledge/connectors/sync-lock'

export const dynamic = 'force-dynamic'

const logger = createLogger('ConnectorMemberSyncSchedulerAPI')

const MAX_DISPATCHES_PER_TICK = 200
const DISPATCH_CONCURRENCY = 10
const STALE_LOCK_ERROR_MESSAGE = 'Member sync timed out (stale lock recovered)'
const LOST_DISPATCH_ERROR_MESSAGE = 'Member sync was queued but never started'

/** The member lease, read through `COALESCE` for the same reason the content reaper does. */
function memberSyncLockLease(): SQL {
  return sql`COALESCE(${knowledgeConnector.memberSyncLockLeaseAt}, ${knowledgeConnector.updatedAt})`
}

function reclaimedFailureCount(): SQL {
  return sql`COALESCE(${knowledgeConnector.memberSyncConsecutiveFailures}, 0) + 1`
}

function reclaimedStatus(): SQL {
  return sql`CASE WHEN ${reclaimedFailureCount()} >= ${MAX_CONSECUTIVE_FAILURES} THEN 'disabled' ELSE 'error' END`
}

function reclaimedError(message: string): SQL {
  return sql`CASE WHEN ${reclaimedFailureCount()} >= ${MAX_CONSECUTIVE_FAILURES} THEN ${CONNECTOR_AUTO_DISABLED_ERROR} ELSE ${message} END`
}

function reclaimedNextMemberSyncAt(): SQL {
  return sql`CASE WHEN ${reclaimedFailureCount()} >= ${MAX_CONSECUTIVE_FAILURES} THEN NULL ELSE now() + LEAST(${reclaimedFailureCount()} * ${CONNECTOR_FAILURE_BACKOFF_STEP_MINUTES}, ${CONNECTOR_FAILURE_BACKOFF_CAP_MINUTES}) * INTERVAL '1 minute' END`
}

/**
 * The write shared by both reclaims: a run that stopped making progress
 * re-enters the member failure ladder, which is the content engine's ladder
 * over the member columns.
 */
function reclaimPayload(message: string) {
  return {
    memberSyncStatus: reclaimedStatus(),
    lastMemberSyncError: reclaimedError(message),
    nextMemberSyncAt: reclaimedNextMemberSyncAt(),
    memberSyncConsecutiveFailures: reclaimedFailureCount(),
    memberSyncLockToken: null,
    memberSyncLockLeaseAt: null,
    updatedAt: sql`now()`,
  }
}

/** Spares a member-sync log row whose run is provably still heartbeating. */
function logRowNotHeldByLiveRun(staleCutoff: Date): SQL {
  return sql`NOT EXISTS (
    SELECT 1 FROM ${knowledgeConnector}
    WHERE ${knowledgeConnector.id} = ${knowledgeConnectorMemberSyncLog.connectorId}
      AND ${knowledgeConnector.memberSyncLockToken} = ${knowledgeConnectorMemberSyncLog.id}
      AND ${knowledgeConnector.memberSyncStatus} = 'running'
      AND ${memberSyncLockLease()} > ${sql.param(staleCutoff, knowledgeConnector.memberSyncLockLeaseAt)}
  )`
}

/**
 * Cron endpoint for members-mode connectors: reclaims stale leases and lost
 * queue entries, closes orphaned run logs, sweeps members whose crawls
 * stopped, and dispatches every connector that is due. Runs every 5 minutes.
 */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()
  logger.info(`[${requestId}] Connector member sync scheduler triggered`)

  const authError = verifyCronAuth(request, 'Connector member sync scheduler')
  if (authError) return authError

  try {
    const now = new Date()
    const staleCutoff = new Date(now.getTime() - MEMBER_SYNC_STALE_LOCK_TTL_MS)

    const [recoveredRunning, recoveredPending, closedLogs] = await Promise.all([
      db
        .update(knowledgeConnector)
        .set(reclaimPayload(STALE_LOCK_ERROR_MESSAGE))
        .where(
          and(
            eq(knowledgeConnector.memberSyncStatus, 'running'),
            sql`${memberSyncLockLease()} <= ${sql.param(staleCutoff, knowledgeConnector.memberSyncLockLeaseAt)}`,
            isNull(knowledgeConnector.archivedAt),
            isNull(knowledgeConnector.deletedAt)
          )
        )
        .returning({ id: knowledgeConnector.id }),
      db
        .update(knowledgeConnector)
        .set(reclaimPayload(LOST_DISPATCH_ERROR_MESSAGE))
        .where(
          and(
            eq(knowledgeConnector.memberSyncStatus, 'pending'),
            sql`${memberSyncLockLease()} <= ${sql.param(staleCutoff, knowledgeConnector.memberSyncLockLeaseAt)}`,
            isNull(knowledgeConnector.archivedAt),
            isNull(knowledgeConnector.deletedAt)
          )
        )
        .returning({ id: knowledgeConnector.id }),
      db
        .update(knowledgeConnectorMemberSyncLog)
        .set({
          status: 'failed',
          completedAt: sql`now()`,
          errorMessage: STALE_LOCK_ERROR_MESSAGE,
        })
        .where(
          and(
            eq(knowledgeConnectorMemberSyncLog.status, 'started'),
            lte(knowledgeConnectorMemberSyncLog.startedAt, staleCutoff),
            logRowNotHeldByLiveRun(staleCutoff)
          )
        )
        .returning({ id: knowledgeConnectorMemberSyncLog.id }),
    ])

    if (recoveredRunning.length > 0) {
      logger.warn(`[${requestId}] Recovered ${recoveredRunning.length} stale member sync run(s)`, {
        ids: recoveredRunning.map((row) => row.id),
      })
    }
    if (recoveredPending.length > 0) {
      logger.warn(
        `[${requestId}] Recovered ${recoveredPending.length} connector(s) whose queued member sync never started`,
        { ids: recoveredPending.map((row) => row.id) }
      )
    }
    if (closedLogs.length > 0) {
      logger.warn(`[${requestId}] Closed ${closedLogs.length} orphaned member sync log(s)`)
    }

    const sweep = await sweepStaleMemberObservations(now)
    if (sweep.members > 0) {
      logger.warn(`[${requestId}] Swept observations of ${sweep.members} stale member(s)`, sweep)
    }

    const dueConnectors = await db
      .select({
        id: knowledgeConnector.id,
        nextMemberSyncAt: knowledgeConnector.nextMemberSyncAt,
        workspaceId: knowledgeBase.workspaceId,
        organizationId: knowledgeBase.organizationId,
      })
      .from(knowledgeConnector)
      .innerJoin(knowledgeBase, eq(knowledgeConnector.knowledgeBaseId, knowledgeBase.id))
      .where(
        and(
          eq(knowledgeConnector.accessMode, 'members'),
          inArray(knowledgeConnector.status, RUNNABLE_CONNECTOR_STATUSES),
          inArray(knowledgeConnector.memberSyncStatus, QUEUEABLE_MEMBER_SYNC_STATUSES),
          lte(knowledgeConnector.nextMemberSyncAt, now),
          isNull(knowledgeConnector.archivedAt),
          isNull(knowledgeConnector.deletedAt),
          isNull(knowledgeBase.deletedAt)
        )
      )
      .orderBy(asc(knowledgeConnector.nextMemberSyncAt))
      .limit(MAX_DISPATCHES_PER_TICK)

    logger.info(`[${requestId}] Found ${dueConnectors.length} connectors due for member sync`)

    if (dueConnectors.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No connectors due for member sync',
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
        await dispatchMemberSync(connector.id, {
          billingAttribution,
          expectedNextMemberSyncAt: connector.nextMemberSyncAt ?? undefined,
          requestId,
          requireRunnable: true,
        })
      } catch (error) {
        logger.error(
          `[${requestId}] Failed to dispatch member sync for connector ${connector.id}`,
          error
        )
      }
    })

    return NextResponse.json({
      success: true,
      message: `Dispatched ${dueConnectors.length} member sync(s)`,
      count: dueConnectors.length,
    })
  } catch (error) {
    logger.error(`[${requestId}] Connector member sync scheduler error`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})
