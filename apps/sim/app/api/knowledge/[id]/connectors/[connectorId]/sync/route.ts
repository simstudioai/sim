import { type NextRequest, NextResponse } from 'next/server'
import { triggerKnowledgeConnectorSyncContract } from '@/lib/api/contracts/knowledge'
import { parseRequest } from '@/lib/api/server'
import { AuthType, checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import {
  requireBillingAttributionHeader,
  resolveBillingAttribution,
} from '@/lib/billing/core/billing-attribution'
import {
  messageForOrchestrationError,
  statusForOrchestrationError,
} from '@/lib/core/orchestration/types'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { performSyncKnowledgeConnector } from '@/lib/knowledge/orchestration'
import { checkKnowledgeBaseWriteAccess } from '@/app/api/knowledge/utils'

type RouteParams = { params: Promise<{ id: string; connectorId: string }> }

/**
 * POST /api/knowledge/[id]/connectors/[connectorId]/sync - Trigger a manual sync
 */
export const POST = withRouteHandler(async (request: NextRequest, context: RouteParams) => {
  const requestId = generateRequestId()
  const parsed = await parseRequest(triggerKnowledgeConnectorSyncContract, request, context)
  if (!parsed.success) return parsed.response
  const { id: knowledgeBaseId, connectorId } = parsed.data.params
  const { rehydrate } = parsed.data.query

  const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const writeCheck = await checkKnowledgeBaseWriteAccess(knowledgeBaseId, auth.userId)
  if (!writeCheck.hasAccess) {
    const status = 'notFound' in writeCheck && writeCheck.notFound ? 404 : 401
    return NextResponse.json({ error: status === 404 ? 'Not found' : 'Unauthorized' }, { status })
  }

  const kbWorkspaceId = writeCheck.knowledgeBase.workspaceId ?? null

  const outcome = await performSyncKnowledgeConnector({
    knowledgeBase: {
      id: knowledgeBaseId,
      name: writeCheck.knowledgeBase.name,
      workspaceId: kbWorkspaceId,
    },
    connectorId,
    resolveBillingAttribution: async () =>
      auth.authType === AuthType.INTERNAL_JWT
        ? requireBillingAttributionHeader(request.headers, {
            actorUserId: auth.userId as string,
            workspaceId: kbWorkspaceId as string,
          })
        : resolveBillingAttribution({
            actorUserId: auth.userId as string,
            workspaceId: kbWorkspaceId as string,
          }),
    rehydrate,
    userId: auth.userId,
    actorName: auth.userName,
    actorEmail: auth.userEmail,
    source: 'ui',
    requestId,
    request,
  })
  if (!outcome.success) {
    return NextResponse.json(
      { error: messageForOrchestrationError(outcome, 'Internal server error') },
      { status: statusForOrchestrationError(outcome.errorCode) }
    )
  }

  return NextResponse.json({ success: true, message: 'Sync triggered' })
})
