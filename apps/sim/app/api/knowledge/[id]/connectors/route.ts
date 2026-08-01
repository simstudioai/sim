import { db } from '@sim/db'
import { knowledgeConnector } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { createKnowledgeConnectorContract } from '@/lib/api/contracts/knowledge'
import { parseRequest } from '@/lib/api/server'
import { AuthType, checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import {
  requireBillingAttributionHeader,
  resolveBillingAttribution,
} from '@/lib/billing/core/billing-attribution'
import {
  messageForOrchestrationError,
  OrchestrationError,
  statusForOrchestrationError,
} from '@/lib/core/orchestration/types'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { performCreateKnowledgeConnector } from '@/lib/knowledge/orchestration'
import { getCredential } from '@/app/api/auth/oauth/utils'
import { checkKnowledgeBaseAccess, checkKnowledgeBaseWriteAccess } from '@/app/api/knowledge/utils'

const logger = createLogger('KnowledgeConnectorsAPI')

/**
 * GET /api/knowledge/[id]/connectors - List connectors for a knowledge base
 */
export const GET = withRouteHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const requestId = generateRequestId()
    const { id: knowledgeBaseId } = await params

    try {
      const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
      if (!auth.success || !auth.userId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const accessCheck = await checkKnowledgeBaseAccess(knowledgeBaseId, auth.userId)
      if (!accessCheck.hasAccess) {
        const status = 'notFound' in accessCheck && accessCheck.notFound ? 404 : 401
        return NextResponse.json(
          { error: status === 404 ? 'Not found' : 'Unauthorized' },
          { status }
        )
      }

      const connectors = await db
        .select()
        .from(knowledgeConnector)
        .where(
          and(
            eq(knowledgeConnector.knowledgeBaseId, knowledgeBaseId),
            isNull(knowledgeConnector.archivedAt),
            isNull(knowledgeConnector.deletedAt)
          )
        )
        .orderBy(desc(knowledgeConnector.createdAt))

      return NextResponse.json({
        success: true,
        data: connectors.map(({ encryptedApiKey: _, ...rest }) => rest),
      })
    } catch (error) {
      logger.error(`[${requestId}] Error listing connectors`, error)
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)

/**
 * POST /api/knowledge/[id]/connectors - Create a new connector
 */
export const POST = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const requestId = generateRequestId()
    const { id: knowledgeBaseId } = await context.params

    const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const writeCheck = await checkKnowledgeBaseWriteAccess(knowledgeBaseId, auth.userId)
    if (!writeCheck.hasAccess) {
      const status = 'notFound' in writeCheck && writeCheck.notFound ? 404 : 401
      return NextResponse.json({ error: status === 404 ? 'Not found' : 'Unauthorized' }, { status })
    }

    const parsed = await parseRequest(createKnowledgeConnectorContract, request, context)
    if (!parsed.success) return parsed.response

    const { connectorType, credentialId, apiKey, sourceConfig, syncIntervalMinutes } =
      parsed.data.body

    const kbWorkspaceId = writeCheck.knowledgeBase.workspaceId
    if (!kbWorkspaceId) {
      return NextResponse.json(
        { error: 'Knowledge base is missing workspace billing context' },
        { status: 409 }
      )
    }

    const outcome = await performCreateKnowledgeConnector({
      knowledgeBase: {
        id: knowledgeBaseId,
        name: writeCheck.knowledgeBase.name,
        workspaceId: kbWorkspaceId,
      },
      connectorType,
      credentialId,
      apiKey,
      sourceConfig,
      syncIntervalMinutes,
      resolveBillingAttribution: async () =>
        auth.authType === AuthType.INTERNAL_JWT
          ? requireBillingAttributionHeader(request.headers, {
              actorUserId: auth.userId as string,
              workspaceId: kbWorkspaceId,
            })
          : resolveBillingAttribution({
              actorUserId: auth.userId as string,
              workspaceId: kbWorkspaceId,
            }),
      resolveAccessToken: async (id) => {
        const credential = await getCredential(requestId, id, auth.userId as string)
        if (!credential) throw new OrchestrationError('validation', 'Credential not found')
        return credential.accessToken ?? null
      },
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

    return NextResponse.json({ success: true, data: outcome.connector }, { status: 201 })
  }
)
