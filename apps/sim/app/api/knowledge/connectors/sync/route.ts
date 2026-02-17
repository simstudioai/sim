import { db } from '@sim/db'
import { knowledgeConnector } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, isNull, lte } from 'drizzle-orm'
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

    const dueConnectors = await db
      .select({
        id: knowledgeConnector.id,
      })
      .from(knowledgeConnector)
      .where(
        and(
          eq(knowledgeConnector.status, 'active'),
          lte(knowledgeConnector.nextSyncAt, now),
          isNull(knowledgeConnector.deletedAt)
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
