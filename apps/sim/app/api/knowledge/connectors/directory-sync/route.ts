import { db } from '@sim/db'
import { knowledgeBase, knowledgeConnector } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { and, asc, eq, inArray, isNotNull, isNull, lte, or } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { verifyCronAuth } from '@/lib/auth/internal'
import { mapWithConcurrency } from '@/lib/core/utils/concurrency'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { EXTERNAL_GROUP_SYNC_INTERVAL_MS } from '@/lib/knowledge/access/external-groups'
import { MIRRORING_ACCESS_MODES } from '@/lib/knowledge/connectors/access-modes'
import { dispatchDirectorySync } from '@/lib/knowledge/connectors/directory-queue'
import { RUNNABLE_CONNECTOR_STATUSES } from '@/lib/knowledge/connectors/sync-lock'

export const dynamic = 'force-dynamic'

const logger = createLogger('ConnectorDirectorySyncSchedulerAPI')

/** Connectors offered per tick, and how many dispatches are in flight at once. */
const MAX_DIRECTORIES_PER_TICK = 200
const DISPATCH_CONCURRENCY = 8

/** Offers the oldest due directories first; successful claims advance across bounded ticks. */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()
  const tickAt = new Date()
  logger.info('Connector directory sync scheduler triggered')

  const authError = verifyCronAuth(request, 'Connector directory sync scheduler')
  if (authError) return authError

  const connectors = await db
    .select({ id: knowledgeConnector.id })
    .from(knowledgeConnector)
    .innerJoin(knowledgeBase, eq(knowledgeConnector.knowledgeBaseId, knowledgeBase.id))
    .where(
      and(
        inArray(knowledgeConnector.accessMode, MIRRORING_ACCESS_MODES),
        lte(knowledgeConnector.nextDirectorySyncAt, tickAt),
        inArray(knowledgeConnector.status, RUNNABLE_CONNECTOR_STATUSES),
        isNull(knowledgeConnector.archivedAt),
        isNull(knowledgeConnector.deletedAt),
        isNull(knowledgeBase.deletedAt),
        or(
          and(isNotNull(knowledgeBase.workspaceId), isNull(knowledgeBase.organizationId)),
          and(isNull(knowledgeBase.workspaceId), isNotNull(knowledgeBase.organizationId))
        )
      )
    )
    .orderBy(asc(knowledgeConnector.nextDirectorySyncAt), asc(knowledgeConnector.id))
    .limit(MAX_DIRECTORIES_PER_TICK)

  let dispatched = 0
  let failed = 0
  await mapWithConcurrency(connectors, DISPATCH_CONCURRENCY, async ({ id: connectorId }) => {
    try {
      const claimed = await db
        .update(knowledgeConnector)
        .set({
          nextDirectorySyncAt: new Date(tickAt.getTime() + EXTERNAL_GROUP_SYNC_INTERVAL_MS),
        })
        .where(
          and(
            eq(knowledgeConnector.id, connectorId),
            lte(knowledgeConnector.nextDirectorySyncAt, tickAt),
            inArray(knowledgeConnector.accessMode, MIRRORING_ACCESS_MODES),
            inArray(knowledgeConnector.status, RUNNABLE_CONNECTOR_STATUSES),
            isNull(knowledgeConnector.archivedAt),
            isNull(knowledgeConnector.deletedAt)
          )
        )
        .returning({ id: knowledgeConnector.id })
      if (!claimed.length) return
      await dispatchDirectorySync(connectorId, { requestId, tickAt })
      dispatched += 1
    } catch (error) {
      failed += 1
      logger.error('Failed to dispatch a directory refresh', {
        connectorId,
        error: getErrorMessage(error),
      })
    }
  })

  const summary = { considered: connectors.length, dispatched, failed }
  logger.info('Connector directory sync scheduler finished', summary)
  return Response.json({ success: true, ...summary })
})
