import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { updateKnowledgeDocumentContract } from '@/lib/api/contracts/knowledge'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  deleteDocument,
  markDocumentAsFailedTimeout,
  retryDocumentProcessing,
  updateDocument,
} from '@/lib/knowledge/documents/service'
import { captureServerEvent } from '@/lib/posthog/server'
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

      return NextResponse.json({
        success: true,
        data: accessCheck.document,
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

      const validatedData = parsed.data.body

      const updateData: any = {}

      if (validatedData.markFailedDueToTimeout) {
        const doc = accessCheck.document

        if (doc.processingStatus !== 'processing') {
          return NextResponse.json(
            { error: `Document is not in processing state (current: ${doc.processingStatus})` },
            { status: 400 }
          )
        }

        if (!doc.processingStartedAt) {
          return NextResponse.json(
            { error: 'Document has no processing start time' },
            { status: 400 }
          )
        }

        try {
          await markDocumentAsFailedTimeout(documentId, doc.processingStartedAt, requestId)

          return NextResponse.json({
            success: true,
            data: {
              documentId,
              status: 'failed',
              message: 'Document marked as failed due to timeout',
            },
          })
        } catch (error) {
          if (error instanceof Error) {
            return NextResponse.json({ error: error.message }, { status: 400 })
          }
          throw error
        }
      } else if (validatedData.retryProcessing) {
        const doc = accessCheck.document

        if (doc.processingStatus !== 'failed') {
          return NextResponse.json({ error: 'Document is not in failed state' }, { status: 400 })
        }

        const docData = {
          filename: doc.filename,
          fileUrl: doc.fileUrl,
          fileSize: doc.fileSize,
          mimeType: doc.mimeType,
        }

        const result = await retryDocumentProcessing(
          knowledgeBaseId,
          documentId,
          docData,
          requestId
        )

        return NextResponse.json({
          success: true,
          data: {
            documentId,
            status: result.status,
            message: result.message,
          },
        })
      } else {
        const updatedDocument = await updateDocument(documentId, validatedData, requestId)

        logger.info(
          `[${requestId}] Document updated: ${documentId} in knowledge base ${knowledgeBaseId}`
        )

        recordAudit({
          workspaceId: accessCheck.knowledgeBase?.workspaceId ?? null,
          actorId: userId,
          actorName: auth.userName,
          actorEmail: auth.userEmail,
          action: AuditAction.DOCUMENT_UPDATED,
          resourceType: AuditResourceType.DOCUMENT,
          resourceId: documentId,
          resourceName: validatedData.filename ?? accessCheck.document?.filename,
          description: `Updated document "${validatedData.filename ?? accessCheck.document?.filename}" in knowledge base "${knowledgeBaseId}"`,
          metadata: {
            knowledgeBaseId,
            knowledgeBaseName: accessCheck.knowledgeBase?.name,
            fileName: validatedData.filename ?? accessCheck.document?.filename,
            updatedFields: Object.keys(validatedData).filter(
              (k) => validatedData[k as keyof typeof validatedData] !== undefined
            ),
            ...(validatedData.enabled !== undefined && { enabled: validatedData.enabled }),
          },
          request: req,
        })

        return NextResponse.json({
          success: true,
          data: updatedDocument,
        })
      }
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

      const result = await deleteDocument(documentId, requestId)

      logger.info(
        `[${requestId}] Document deleted: ${documentId} from knowledge base ${knowledgeBaseId}`
      )

      recordAudit({
        workspaceId: accessCheck.knowledgeBase?.workspaceId ?? null,
        actorId: userId,
        actorName: auth.userName,
        actorEmail: auth.userEmail,
        action: AuditAction.DOCUMENT_DELETED,
        resourceType: AuditResourceType.DOCUMENT,
        resourceId: documentId,
        resourceName: accessCheck.document?.filename,
        description: `Deleted document "${accessCheck.document?.filename}" from knowledge base "${knowledgeBaseId}"`,
        metadata: {
          knowledgeBaseId,
          knowledgeBaseName: accessCheck.knowledgeBase?.name,
          fileName: accessCheck.document?.filename,
          fileSize: accessCheck.document?.fileSize,
          mimeType: accessCheck.document?.mimeType,
        },
        request: req,
      })

      const kbWorkspaceId = accessCheck.knowledgeBase?.workspaceId ?? ''
      captureServerEvent(
        userId,
        'knowledge_base_document_deleted',
        { knowledge_base_id: knowledgeBaseId, workspace_id: kbWorkspaceId },
        kbWorkspaceId ? { groups: { workspace: kbWorkspaceId } } : undefined
      )

      return NextResponse.json({
        success: true,
        data: result,
      })
    } catch (error) {
      logger.error(`[${requestId}] Error deleting document`, error)
      return NextResponse.json({ error: 'Failed to delete document' }, { status: 500 })
    }
  }
)
