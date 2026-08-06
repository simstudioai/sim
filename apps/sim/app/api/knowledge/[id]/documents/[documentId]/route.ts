import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { updateKnowledgeDocumentContract } from '@/lib/api/contracts/knowledge'
import { parseRequest } from '@/lib/api/server'
import { AuthType, checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import {
  requireBillingAttributionHeader,
  resolveBillingAttribution,
} from '@/lib/billing/core/billing-attribution'
import {
  messageForOrchestrationError,
  type OrchestrationErrorCode,
  statusForOrchestrationError,
} from '@/lib/core/orchestration/types'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  performDeleteKnowledgeDocument,
  performMarkKnowledgeDocumentTimedOut,
  performRetryKnowledgeDocumentProcessing,
  performUpdateKnowledgeDocument,
} from '@/lib/knowledge/orchestration'
import { createKnowledgeDocumentSourceValue } from '@/lib/knowledge/secret-provenance'
import { createKnowledgePersistedResponse } from '@/app/api/knowledge/secret-provenance'
import { checkDocumentAccess, checkDocumentWriteAccess } from '@/app/api/knowledge/utils'

const logger = createLogger('DocumentByIdAPI')

export const GET = withRouteHandler(
  async (req: NextRequest, { params }: { params: Promise<{ id: string; documentId: string }> }) => {
    const requestId = generateRequestId()
    const { id: knowledgeBaseId, documentId } = await params

    try {
      const auth = await checkSessionOrInternalAuth(req, { requireWorkflowId: false })
      if (!auth.success || !auth.userId) {
        logger.warn(`[${requestId}] Unauthorized document access attempt`)
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
      const userId = auth.userId

      const accessCheck = await checkDocumentAccess(knowledgeBaseId, documentId, userId)

      if (!accessCheck.hasAccess) {
        if (accessCheck.notFound) {
          logger.warn(
            `[${requestId}] ${accessCheck.reason}: KB=${knowledgeBaseId}, Doc=${documentId}`
          )
          return NextResponse.json({ error: accessCheck.reason }, { status: 404 })
        }
        logger.warn(
          `[${requestId}] User ${userId} attempted unauthorized document access: ${accessCheck.reason}`
        )
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      logger.info(
        `[${requestId}] Retrieved document: ${documentId} from knowledge base ${knowledgeBaseId}`
      )

      const responseBody = {
        success: true,
        data: accessCheck.document,
      }
      const workspaceId = accessCheck.knowledgeBase?.workspaceId ?? undefined
      return createKnowledgePersistedResponse({
        request: req,
        authType: auth.authType,
        userId,
        ...(workspaceId ? { workspaceId } : {}),
        body: responseBody,
        documents: accessCheck.document
          ? [
              {
                id: accessCheck.document.id,
                source: createKnowledgeDocumentSourceValue(accessCheck.document),
                value: accessCheck.document,
              },
            ]
          : [],
      })
    } catch (error) {
      logger.error(`[${requestId}] Error fetching document`, error)
      return NextResponse.json({ error: 'Failed to fetch document' }, { status: 500 })
    }
  }
)

export const PUT = withRouteHandler(
  async (req: NextRequest, { params }: { params: Promise<{ id: string; documentId: string }> }) => {
    const requestId = generateRequestId()
    const { id: knowledgeBaseId, documentId } = await params

    try {
      const auth = await checkSessionOrInternalAuth(req, { requireWorkflowId: false })
      if (!auth.success || !auth.userId) {
        logger.warn(`[${requestId}] Unauthorized document update attempt`)
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
      const userId = auth.userId

      const accessCheck = await checkDocumentWriteAccess(knowledgeBaseId, documentId, userId)

      if (!accessCheck.hasAccess) {
        if (accessCheck.notFound) {
          logger.warn(
            `[${requestId}] ${accessCheck.reason}: KB=${knowledgeBaseId}, Doc=${documentId}`
          )
          return NextResponse.json({ error: accessCheck.reason }, { status: 404 })
        }
        logger.warn(
          `[${requestId}] User ${userId} attempted unauthorized document update: ${accessCheck.reason}`
        )
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const parsed = await parseRequest(
        updateKnowledgeDocumentContract,
        req,
        { params },
        {
          validationErrorResponse: (error) => {
            logger.warn(`[${requestId}] Invalid document update data`, { errors: error.issues })
            return NextResponse.json(
              { error: 'Invalid request data', details: error.issues },
              { status: 400 }
            )
          },
        }
      )
      if (!parsed.success) return parsed.response

      const { markFailedDueToTimeout, retryProcessing, ...documentUpdates } = parsed.data.body
      const doc = accessCheck.document
      const workspaceId = accessCheck.knowledgeBase?.workspaceId ?? null

      const failed = (outcome: { error?: string; errorCode?: OrchestrationErrorCode }) =>
        NextResponse.json(
          { error: messageForOrchestrationError(outcome, 'Failed to update document') },
          { status: statusForOrchestrationError(outcome.errorCode) }
        )

      if (markFailedDueToTimeout) {
        const outcome = await performMarkKnowledgeDocumentTimedOut({
          document: doc,
          requestId,
        })
        if (!outcome.success) return failed(outcome)

        return NextResponse.json({
          success: true,
          data: { documentId, status: outcome.status, message: outcome.message },
        })
      }

      if (retryProcessing) {
        const billingAttribution = workspaceId
          ? auth.authType === AuthType.INTERNAL_JWT
            ? requireBillingAttributionHeader(req.headers, {
                actorUserId: userId,
                workspaceId,
              })
            : await resolveBillingAttribution({
                actorUserId: userId,
                workspaceId,
              })
          : undefined

        const outcome = await performRetryKnowledgeDocumentProcessing({
          knowledgeBaseId,
          document: doc,
          billingAttribution,
          requestId,
        })
        if (!outcome.success) return failed(outcome)

        return NextResponse.json({
          success: true,
          data: { documentId, status: outcome.status, message: outcome.message },
        })
      }

      const outcome = await performUpdateKnowledgeDocument({
        knowledgeBase: {
          id: knowledgeBaseId,
          name: accessCheck.knowledgeBase?.name,
          workspaceId,
        },
        document: { id: documentId, filename: doc.filename },
        updates: documentUpdates,
        userId,
        actorName: auth.userName,
        actorEmail: auth.userEmail,
        source: 'ui',
        requestId,
        request: req,
      })
      if (!outcome.success) return failed(outcome)

      return NextResponse.json({ success: true, data: outcome.document })
    } catch (error) {
      logger.error(`[${requestId}] Error updating document ${documentId}`, error)
      return NextResponse.json({ error: 'Failed to update document' }, { status: 500 })
    }
  }
)

export const DELETE = withRouteHandler(
  async (req: NextRequest, { params }: { params: Promise<{ id: string; documentId: string }> }) => {
    const requestId = generateRequestId()
    const { id: knowledgeBaseId, documentId } = await params

    try {
      const auth = await checkSessionOrInternalAuth(req, { requireWorkflowId: false })
      if (!auth.success || !auth.userId) {
        logger.warn(`[${requestId}] Unauthorized document delete attempt`)
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
      const userId = auth.userId

      const accessCheck = await checkDocumentWriteAccess(knowledgeBaseId, documentId, userId)

      if (!accessCheck.hasAccess) {
        if (accessCheck.notFound) {
          logger.warn(
            `[${requestId}] ${accessCheck.reason}: KB=${knowledgeBaseId}, Doc=${documentId}`
          )
          return NextResponse.json({ error: accessCheck.reason }, { status: 404 })
        }
        logger.warn(
          `[${requestId}] User ${userId} attempted unauthorized document deletion: ${accessCheck.reason}`
        )
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const outcome = await performDeleteKnowledgeDocument({
        knowledgeBase: {
          id: knowledgeBaseId,
          name: accessCheck.knowledgeBase?.name,
          workspaceId: accessCheck.knowledgeBase?.workspaceId ?? null,
        },
        document: accessCheck.document,
        userId,
        actorName: auth.userName,
        actorEmail: auth.userEmail,
        source: 'ui',
        requestId,
        request: req,
      })
      if (!outcome.success) {
        return NextResponse.json(
          { error: messageForOrchestrationError(outcome, 'Failed to delete document') },
          { status: statusForOrchestrationError(outcome.errorCode) }
        )
      }

      return NextResponse.json({
        success: true,
        data: { success: true, message: 'Document deleted successfully' },
      })
    } catch (error) {
      logger.error(`[${requestId}] Error deleting document`, error)
      return NextResponse.json({ error: 'Failed to delete document' }, { status: 500 })
    }
  }
)
