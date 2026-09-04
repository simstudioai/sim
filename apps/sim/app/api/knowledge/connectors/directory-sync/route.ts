import { db } from '@sim/db'
import { knowledgeBase, knowledgeConnector } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { and, asc, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { verifyCronAuth } from '@/lib/auth/internal'
import { mapWithConcurrency } from '@/lib/core/utils/concurrency'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { MIRRORING_ACCESS_MODES } from '@/lib/knowledge/connectors/access-modes'
import { dispatchDirectorySync } from '@/lib/knowledge/connectors/directory-queue'
import { RUNNABLE_CONNECTOR_STATUSES } from '@/lib/knowledge/connectors/sync-lock'

export const dynamic = 'force-dynamic'

const logger = createLogger('ConnectorDirectorySyncSchedulerAPI')

/** Connectors offered per tick, and how many dispatches are in flight at once. */
const MAX_DIRECTORIES_PER_TICK = 200
const DISPATCH_CONCURRENCY = 8

/**
 * Refreshes the external directories that admin-mode connectors mirror.
 *
 * Group membership decides who can read an already-indexed document, so it has
 * to move on its own clock: someone leaving a group should lose access in
 * minutes, not on whatever schedule the corpus happens to be re-crawled on. The
 * admin crawl refreshes the directory too — so a crawl can never publish grants
 * against membership nobody has read — but that is a floor, not the cadence.
 *
 * Every eligible connector is offered each tick, and
 * `syncExternalDirectoryGroups` decides whether its directory is actually due:
 * a tenant is the credential's own site or domain, which the row does not
 * carry, so connectors sharing one cost a refresh and a skip rather than a
 * refresh each. The walk itself runs in the background, like every other
 * connector job, because a large domain takes longer than a scheduler request
 * lives.
 */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()
  const tickAt = new Date()
  logger.info(`[${requestId}] Connector directory sync scheduler triggered`)

  const authError = verifyCronAuth(request, 'Connector directory sync scheduler')
  if (authError) return authError

  const connectors = await db
    .select({ id: knowledgeConnector.id })
    .from(knowledgeConnector)
    .innerJoin(knowledgeBase, eq(knowledgeConnector.knowledgeBaseId, knowledgeBase.id))
    .where(
      and(
        inArray(knowledgeConnector.accessMode, MIRRORING_ACCESS_MODES),
        inArray(knowledgeConnector.status, RUNNABLE_CONNECTOR_STATUSES),
        isNull(knowledgeConnector.archivedAt),
        isNull(knowledgeConnector.deletedAt),
        isNull(knowledgeBase.deletedAt),
        isNotNull(knowledgeBase.workspaceId)
      )
    )
    .orderBy(asc(knowledgeConnector.createdAt))
    .limit(MAX_DIRECTORIES_PER_TICK)

  let dispatched = 0
  let failed = 0
  await mapWithConcurrency(connectors, DISPATCH_CONCURRENCY, async ({ id: connectorId }) => {
    try {
      await dispatchDirectorySync(connectorId, { requestId, tickAt })
      dispatched += 1
    } catch (error) {
      failed += 1
      logger.error(`[${requestId}] Failed to dispatch a directory refresh`, {
        connectorId,
        error: getErrorMessage(error),
      })
    }
  })

  const summary = { considered: connectors.length, dispatched, failed }
  logger.info(`[${requestId}] Connector directory sync scheduler finished`, summary)
  return Response.json({ success: true, ...summary })
})
