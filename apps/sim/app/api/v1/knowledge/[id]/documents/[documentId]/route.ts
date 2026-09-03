import { type NextRequest, NextResponse } from 'next/server'
import {
  v1DeleteKnowledgeDocumentContract,
  v1GetKnowledgeDocumentContract,
} from '@/lib/api/contracts/v1/knowledge'
import { parseRequest } from '@/lib/api/server'
import {
  messageForOrchestrationError,
  statusForOrchestrationError,
} from '@/lib/core/orchestration/types'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getKnowledgeDocument } from '@/lib/knowledge/documents/service'
import { performDeleteKnowledgeDocument } from '@/lib/knowledge/orchestration'
import {
  handleError,
  resolveKnowledgeBase,
  resolveV1KnowledgeAccessScope,
  serializeDate,
} from '@/app/api/v1/knowledge/utils'
import { authenticateRequest, v1ValidationErrorResponse } from '@/app/api/v1/middleware'

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface DocumentDetailRouteParams {
  params: Promise<{ id: string; documentId: string }>
}

/** GET /api/v1/knowledge/[id]/documents/[documentId] — Get document details. */
export const GET = withRouteHandler(
  async (request: NextRequest, context: DocumentDetailRouteParams) => {
    const auth = await authenticateRequest(request, 'knowledge-detail')
    if (auth instanceof NextResponse) return auth
    const { requestId, userId, rateLimit } = auth

    try {
      const parsed = await parseRequest(v1GetKnowledgeDocumentContract, request, context, {
        validationErrorResponse: v1ValidationErrorResponse,
      })
      if (!parsed.success) return parsed.response
      const { id: knowledgeBaseId, documentId } = parsed.data.params

      const result = await resolveKnowledgeBase(
        knowledgeBaseId,
        parsed.data.query.workspaceId,
        userId,
        rateLimit,
        'knowledge.use'
      )
      if (result instanceof NextResponse) return result

      const doc = await getKnowledgeDocument(
        knowledgeBaseId,
        documentId,
        await resolveV1KnowledgeAccessScope(userId, rateLimit, parsed.data.query.workspaceId)
      )

      if (!doc) {
        return NextResponse.json({ error: 'Document not found' }, { status: 404 })
      }

      return NextResponse.json({
        success: true,
        data: {
          document: {
            id: doc.id,
            knowledgeBaseId: doc.knowledgeBaseId,
            filename: doc.filename,
            fileSize: doc.fileSize,
            mimeType: doc.mimeType,
            processingStatus: doc.processingStatus,
            processingError: doc.processingError,
            processingStartedAt: serializeDate(doc.processingStartedAt),
            processingCompletedAt: serializeDate(doc.processingCompletedAt),
            chunkCount: doc.chunkCount,
            tokenCount: doc.tokenCount,
            characterCount: doc.characterCount,
            enabled: doc.enabled,
            connectorId: doc.connectorId,
            connectorType: doc.connectorType,
            sourceUrl: doc.sourceUrl,
            createdAt: serializeDate(doc.uploadedAt),
          },
        },
      })
    } catch (error) {
      return handleError(requestId, error, 'Failed to get document')
    }
  }
)

/** DELETE /api/v1/knowledge/[id]/documents/[documentId] — Delete a document. */
export const DELETE = withRouteHandler(
  async (request: NextRequest, context: DocumentDetailRouteParams) => {
    const auth = await authenticateRequest(request, 'knowledge-detail')
    if (auth instanceof NextResponse) return auth
    const { requestId, userId, rateLimit } = auth

    try {
      const parsed = await parseRequest(v1DeleteKnowledgeDocumentContract, request, context, {
        validationErrorResponse: v1ValidationErrorResponse,
      })
      if (!parsed.success) return parsed.response
      const { id: knowledgeBaseId, documentId } = parsed.data.params

      const result = await resolveKnowledgeBase(
        knowledgeBaseId,
        parsed.data.query.workspaceId,
        userId,
        rateLimit,
        'knowledge.use',
        'write'
      )
      if (result instanceof NextResponse) return result

      const access = await resolveV1KnowledgeAccessScope(
        userId,
        rateLimit,
        parsed.data.query.workspaceId
      )
      const doc = await getKnowledgeDocument(knowledgeBaseId, documentId, access)

      if (!doc) {
        return NextResponse.json({ error: 'Document not found' }, { status: 404 })
      }

      const outcome = await performDeleteKnowledgeDocument({
        knowledgeBase: {
          id: knowledgeBaseId,
          name: result.kb.name,
          workspaceId: parsed.data.query.workspaceId,
        },
        document: { id: documentId, filename: doc.filename },
        access,
        userId,
        source: 'api',
        requestId,
        request,
      })
      if (!outcome.success) {
        return NextResponse.json(
          { error: messageForOrchestrationError(outcome, 'Failed to delete document') },
          { status: statusForOrchestrationError(outcome.errorCode) }
        )
      }

      return NextResponse.json({
        success: true,
        data: {
          message: 'Document deleted successfully',
        },
      })
    } catch (error) {
      return handleError(requestId, error, 'Failed to delete document')
    }
  }
)
