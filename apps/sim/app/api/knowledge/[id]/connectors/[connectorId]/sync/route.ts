import { db } from '@sim/db'
import { knowledgeConnector } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, isNull } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { dispatchSync } from '@/lib/knowledge/connectors/sync-engine'
import { checkKnowledgeBaseWriteAccess } from '@/app/api/knowledge/utils'

const logger = createLogger('ConnectorManualSyncAPI')

type RouteParams = { params: Promise<{ id: string; connectorId: string }> }

/**
 * POST /api/knowledge/[id]/connectors/[connectorId]/sync - Trigger a manual sync
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const requestId = generateRequestId()
  const { id: knowledgeBaseId, connectorId } = await params

  try {
    const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const writeCheck = await checkKnowledgeBaseWriteAccess(knowledgeBaseId, auth.userId)
    if (!writeCheck.hasAccess) {
      const status = 'notFound' in writeCheck && writeCheck.notFound ? 404 : 401
      return NextResponse.json({ error: status === 404 ? 'Not found' : 'Unauthorized' }, { status })
    }

    const connectorRows = await db
      .select()
      .from(knowledgeConnector)
      .where(
        and(
          eq(knowledgeConnector.id, connectorId),
          eq(knowledgeConnector.knowledgeBaseId, knowledgeBaseId),
          isNull(knowledgeConnector.deletedAt)
        )
      )
      .limit(1)

    if (connectorRows.length === 0) {
      return NextResponse.json({ error: 'Connector not found' }, { status: 404 })
    }

    if (connectorRows[0].status === 'syncing') {
      return NextResponse.json({ error: 'Sync already in progress' }, { status: 409 })
    }

    logger.info(`[${requestId}] Manual sync triggered for connector ${connectorId}`)

    dispatchSync(connectorId, { requestId }).catch((error) => {
      logger.error(
        `[${requestId}] Failed to dispatch manual sync for connector ${connectorId}`,
        error
      )
    })

    return NextResponse.json({
      success: true,
      message: 'Sync triggered',
    })
  } catch (error) {
    logger.error(`[${requestId}] Error triggering manual sync`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
