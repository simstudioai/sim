import { db } from '@sim/db'
import { knowledgeBase, knowledgeConnector } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { verifyCronAuth } from '@/lib/auth/internal'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { dispatchDirectorySync } from '@/lib/knowledge/connectors/directory-queue'
import { RUNNABLE_CONNECTOR_STATUSES } from '@/lib/knowledge/connectors/sync-lock'

export const dynamic = 'force-dynamic'

const logger = createLogger('ConnectorDirectorySyncSchedulerAPI')

/** Directories dispatched per tick. */
const MAX_DIRECTORIES_PER_TICK = 200

/**
 * Refreshes the external directories that admin-mode connectors mirror.
 *
 * Group membership decides who can read an already-indexed document, so it has
 * to move on its own clock: someone leaving a group should lose access in
 * minutes, not on whatever schedule the corpus happens to be re-crawled on. The
 * admin crawl refreshes the directory too — so a crawl can never publish grants
 * against membership nobody has read — but that is a floor, not the cadence.
 *
 * Connectors sharing a directory cost one refresh between them: the tick
 * dispatches one connector per workspace and provider, and
 * `syncExternalDirectoryGroups` decides whether that directory is actually
 * due. The walk itself runs in the background, like every other connector
 * job, because a large domain takes longer than a scheduler request lives.
 */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()
  const tickAt = new Date()
  logger.info(`[${requestId}] Connector directory sync scheduler triggered`)

  const authError = verifyCronAuth(request, 'Connector directory sync scheduler')
  if (authError) return authError

  const connectors = await db
    .select({
      id: knowledgeConnector.id,
      connectorType: knowledgeConnector.connectorType,
      workspaceId: knowledgeBase.workspaceId,
    })
    .from(knowledgeConnector)
    .innerJoin(knowledgeBase, eq(knowledgeConnector.knowledgeBaseId, knowledgeBase.id))
    .where(
      and(
        eq(knowledgeConnector.accessMode, 'admin'),
        inArray(knowledgeConnector.status, RUNNABLE_CONNECTOR_STATUSES),
        isNull(knowledgeConnector.archivedAt),
        isNull(knowledgeConnector.deletedAt),
        isNull(knowledgeBase.deletedAt)
      )
    )
    .orderBy(asc(knowledgeConnector.createdAt))

  /**
   * One connector per directory. A connector type implies its provider, and
   * two connectors of one type in one workspace share a directory by
   * construction — the first to be created stands for it.
   */
  const representatives = new Map<string, string>()
  for (const connector of connectors) {
    if (!connector.workspaceId) continue
    const key = `${connector.workspaceId}:${connector.connectorType}`
    if (!representatives.has(key)) representatives.set(key, connector.id)
  }
  const due = [...representatives.values()].slice(0, MAX_DIRECTORIES_PER_TICK)

  let dispatched = 0
  let failed = 0
  for (const connectorId of due) {
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
  }

  const summary = { considered: connectors.length, directories: due.length, dispatched, failed }
  logger.info(`[${requestId}] Connector directory sync scheduler finished`, summary)
  return Response.json({ success: true, ...summary })
})
