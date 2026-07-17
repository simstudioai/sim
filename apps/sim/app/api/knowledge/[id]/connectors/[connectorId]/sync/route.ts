import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { knowledgeConnector } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, isNull } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { triggerKnowledgeConnectorSyncContract } from '@/lib/api/contracts/knowledge'
import { parseRequest } from '@/lib/api/server'
import { AuthType, checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import {
  requireBillingAttributionHeader,
  resolveBillingAttribution,
} from '@/lib/billing/core/billing-attribution'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { dispatchSync } from '@/lib/knowledge/connectors/queue'
import { captureServerEvent } from '@/lib/posthog/server'
import { checkKnowledgeBaseWriteAccess } from '@/app/api/knowledge/utils'

const logger = createLogger('ConnectorManualSyncAPI')

type RouteParams = { params: Promise<{ id: string; connectorId: string }> }

/**
 * POST /api/knowledge/[id]/connectors/[connectorId]/sync - Trigger a manual sync
 */
export const POST = withRouteHandler(async (request: NextRequest, context: RouteParams) => {
  const requestId = generateRequestId()
  const parsed = await parseRequest(triggerKnowledgeConnectorSyncContract, request, context)
  if (!parsed.success) return parsed.response
  const { id: knowledgeBaseId, connectorId } = parsed.data.params
  const fullSync = parsed.data.query?.fullSync === 'true'

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
          isNull(knowledgeConnector.archivedAt),
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

    const kbWorkspaceId = writeCheck.knowledgeBase.workspaceId
    if (!kbWorkspaceId) {
      return NextResponse.json(
        { error: 'Knowledge base is missing workspace billing context' },
        { status: 409 }
      )
    }
    const billingAttribution =
      auth.authType === AuthType.INTERNAL_JWT
        ? requireBillingAttributionHeader(request.headers, {
            actorUserId: auth.userId,
            workspaceId: kbWorkspaceId,
          })
        : await resolveBillingAttribution({
            actorUserId: auth.userId,
            workspaceId: kbWorkspaceId,
          })

    logger.info(
      `[${requestId}] Manual ${fullSync ? 'full ' : ''}sync triggered for connector ${connectorId}`
    )

    captureServerEvent(
      auth.userId,
      'knowledge_base_connector_synced',
      {
        knowledge_base_id: knowledgeBaseId,
        workspace_id: kbWorkspaceId,
        connector_type: connectorRows[0].connectorType,
      },
      kbWorkspaceId ? { groups: { workspace: kbWorkspaceId } } : undefined
    )

    recordAudit({
      workspaceId: writeCheck.knowledgeBase.workspaceId,
      actorId: auth.userId,
      actorName: auth.userName,
      actorEmail: auth.userEmail,
      action: AuditAction.CONNECTOR_SYNCED,
      resourceType: AuditResourceType.CONNECTOR,
      resourceId: connectorId,
      resourceName: connectorRows[0].connectorType,
      description: `Triggered manual sync for connector on knowledge base "${writeCheck.knowledgeBase.name}"`,
      metadata: {
        knowledgeBaseId,
        knowledgeBaseName: writeCheck.knowledgeBase.name,
        connectorType: connectorRows[0].connectorType,
        connectorStatus: connectorRows[0].status,
        syncType: fullSync ? 'manual-full' : 'manual',
      },
      request,
    })

    dispatchSync(connectorId, { billingAttribution, requestId, fullSync }).catch((error) => {
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
})
