import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { document, knowledgeConnector } from '@sim/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import {
  v1DeleteKnowledgeDocumentContract,
  v1GetKnowledgeDocumentContract,
} from '@/lib/api/contracts/v1/knowledge'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { deleteDocument } from '@/lib/knowledge/documents/service'
import { handleError, resolveKnowledgeBase, serializeDate } from '@/app/api/v1/knowledge/utils'
import { authenticateRequest } from '@/app/api/v1/middleware'

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
      const parsed = await parseRequest(v1GetKnowledgeDocumentContract, request, context)
      if (!parsed.success) return parsed.response
      const { id: knowledgeBaseId, documentId } = parsed.data.params

      const result = await resolveKnowledgeBase(
        knowledgeBaseId,
        parsed.data.query.workspaceId,
        userId,
        rateLimit
      )
      if (result instanceof NextResponse) return result

      const docs = await db
        .select({
          id: document.id,
          knowledgeBaseId: document.knowledgeBaseId,
          filename: document.filename,
          fileSize: document.fileSize,
          mimeType: document.mimeType,
          processingStatus: document.processingStatus,
          processingError: document.processingError,
          processingStartedAt: document.processingStartedAt,
          processingCompletedAt: document.processingCompletedAt,
          chunkCount: document.chunkCount,
          tokenCount: document.tokenCount,
          characterCount: document.characterCount,
          enabled: document.enabled,
          uploadedAt: document.uploadedAt,
          connectorId: document.connectorId,
          connectorType: knowledgeConnector.connectorType,
          sourceUrl: document.sourceUrl,
        })
        .from(document)
        .leftJoin(knowledgeConnector, eq(document.connectorId, knowledgeConnector.id))
        .where(
          and(
            eq(document.id, documentId),
            eq(document.knowledgeBaseId, knowledgeBaseId),
            eq(document.userExcluded, false),
            isNull(document.archivedAt),
            isNull(document.deletedAt)
          )
        )
        .limit(1)

      if (docs.length === 0) {
        return NextResponse.json({ error: 'Document not found' }, { status: 404 })
      }

      const doc = docs[0]

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
      const parsed = await parseRequest(v1DeleteKnowledgeDocumentContract, request, context)
      if (!parsed.success) return parsed.response
      const { id: knowledgeBaseId, documentId } = parsed.data.params

      const result = await resolveKnowledgeBase(
        knowledgeBaseId,
        parsed.data.query.workspaceId,
        userId,
        rateLimit,
        'write'
      )
      if (result instanceof NextResponse) return result

      const docs = await db
        .select({ id: document.id, filename: document.filename })
        .from(document)
        .where(
          and(
            eq(document.id, documentId),
            eq(document.knowledgeBaseId, knowledgeBaseId),
            eq(document.userExcluded, false),
            isNull(document.archivedAt),
            isNull(document.deletedAt)
          )
        )
        .limit(1)

      if (docs.length === 0) {
        return NextResponse.json({ error: 'Document not found' }, { status: 404 })
      }

      await deleteDocument(documentId, requestId)

      recordAudit({
        workspaceId: parsed.data.query.workspaceId,
        actorId: userId,
        action: AuditAction.DOCUMENT_DELETED,
        resourceType: AuditResourceType.DOCUMENT,
        resourceId: documentId,
        resourceName: docs[0].filename,
        description: `Deleted document "${docs[0].filename}" from knowledge base via API`,
        metadata: { knowledgeBaseId },
        request,
      })

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
