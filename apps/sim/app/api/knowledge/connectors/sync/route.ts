import { db } from '@sim/db'
import { knowledgeBase, knowledgeConnector } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, inArray, isNull, lte } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/auth/internal'
import { generateRequestId } from '@/lib/core/utils/request'
import { dispatchSync } from '@/lib/knowledge/connectors/sync-engine'

export const dynamic = 'force-dynamic'

const logger = createLogger('ConnectorSyncSchedulerAPI')

/**
 * Cron endpoint that checks for connectors due for sync and dispatches sync jobs.
 * Should be called every 5 minutes by an external cron service.
 */
export async function GET(request: NextRequest) {
  const requestId = generateRequestId()
  logger.info(`[${requestId}] Connector sync scheduler triggered`)

  const authError = verifyCronAuth(request, 'Connector sync scheduler')
  if (authError) {
    return authError
  }

  try {
    const now = new Date()

    const STALE_SYNC_TTL_MS = 120 * 60 * 1000
    const staleCutoff = new Date(now.getTime() - STALE_SYNC_TTL_MS)

    const recoveredConnectors = await db
      .update(knowledgeConnector)
      .set({
        status: 'error',
        lastSyncError: 'Sync timed out (stale lock recovered)',
        nextSyncAt: new Date(now.getTime() + 10 * 60 * 1000),
        updatedAt: now,
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

    const dueConnectors = await db
      .select({
        id: knowledgeConnector.id,
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

    logger.info(`[${requestId}] Found ${dueConnectors.length} connectors due for sync`)

    if (dueConnectors.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No connectors due for sync',
        count: 0,
      })
    }

    for (const connector of dueConnectors) {
      dispatchSync(connector.id, { requestId }).catch((error) => {
        logger.error(`[${requestId}] Failed to dispatch sync for connector ${connector.id}`, error)
      })
    }

    return NextResponse.json({
      success: true,
      message: `Dispatched ${dueConnectors.length} connector sync(s)`,
      count: dueConnectors.length,
    })
  } catch (error) {
    logger.error(`[${requestId}] Connector sync scheduler error`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
