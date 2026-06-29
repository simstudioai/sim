import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { document, knowledgeConnector } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { and, eq, isNull } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import {
  type V2KnowledgeDocument,
  v2DeleteKnowledgeDocumentContract,
  v2GetKnowledgeDocumentContract,
} from '@/lib/api/contracts/v2/knowledge'
import { parseRequest } from '@/lib/api/server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { deleteDocument } from '@/lib/knowledge/documents/service'
import type { KnowledgeBaseWithCounts } from '@/lib/knowledge/types'
import { resolveKnowledgeBase, serializeDate } from '@/app/api/v1/knowledge/utils'
import { checkRateLimit, type RateLimitResult } from '@/app/api/v1/middleware'
import { v2Data, v2Error, v2RateLimitError, v2ValidationError } from '@/app/api/v2/lib/response'

const logger = createLogger('V2KnowledgeDocumentDetailAPI')

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface DocumentDetailRouteParams {
  params: Promise<{ id: string; documentId: string }>
}

/**
 * Resolves a knowledge base via the shared v1 ownership invariant
 * ({@link resolveKnowledgeBase}) and renders any failure in the v2 envelope. A
 * `404` is always `NOT_FOUND`; a `403` is masked as `NOT_FOUND` on reads and
 * surfaced as `FORBIDDEN` on writes.
 */
async function resolveKnowledgeBaseScoped(
  id: string,
  workspaceId: string,
  userId: string,
  rateLimit: RateLimitResult,
  level: 'read' | 'write'
): Promise<{ kb: KnowledgeBaseWithCounts } | NextResponse> {
  const result = await resolveKnowledgeBase(id, workspaceId, userId, rateLimit, level)
  if (!(result instanceof NextResponse)) return result
  if (result.status === 404) return v2Error('NOT_FOUND', 'Knowledge base not found')
  return level === 'read'
    ? v2Error('NOT_FOUND', 'Knowledge base not found')
    : v2Error('FORBIDDEN', 'Access denied')
}

/** GET /api/v2/knowledge/[id]/documents/[documentId] — Get document details. */
export const GET = withRouteHandler(
  async (request: NextRequest, context: DocumentDetailRouteParams) => {
    const requestId = generateRequestId()

    try {
      const rateLimit = await checkRateLimit(request, 'knowledge-detail')
      if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

      const userId = rateLimit.userId!
      const parsed = await parseRequest(v2GetKnowledgeDocumentContract, request, context, {
        validationErrorResponse: v2ValidationError,
      })
      if (!parsed.success) return parsed.response

      const { id: knowledgeBaseId, documentId } = parsed.data.params

      const result = await resolveKnowledgeBaseScoped(
        knowledgeBaseId,
        parsed.data.query.workspaceId,
        userId,
        rateLimit,
        'read'
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

      const doc = docs[0]
      if (!doc) return v2Error('NOT_FOUND', 'Document not found')

      const documentDetail: V2KnowledgeDocument = {
        id: doc.id,
        knowledgeBaseId: doc.knowledgeBaseId,
        filename: doc.filename,
        fileSize: doc.fileSize,
        mimeType: doc.mimeType,
        processingStatus: doc.processingStatus as V2KnowledgeDocument['processingStatus'],
        processingError: doc.processingError,
        processingStartedAt: serializeDate(doc.processingStartedAt),
        processingCompletedAt: serializeDate(doc.processingCompletedAt),
        chunkCount: doc.chunkCount,
        tokenCount: doc.tokenCount,
        characterCount: doc.characterCount,
        enabled: doc.enabled,
        connectorId: doc.connectorId,
        connectorType: doc.connectorType ?? null,
        sourceUrl: doc.sourceUrl,
        createdAt: serializeDate(doc.uploadedAt),
      }

      return v2Data({ document: documentDetail }, { rateLimit })
    } catch (error) {
      logger.error(`[${requestId}] Error getting document`, {
        error: getErrorMessage(error, 'Unknown error'),
      })
      return v2Error('INTERNAL_ERROR', 'Internal server error')
    }
  }
)

/** DELETE /api/v2/knowledge/[id]/documents/[documentId] — Delete a document. */
export const DELETE = withRouteHandler(
  async (request: NextRequest, context: DocumentDetailRouteParams) => {
    const requestId = generateRequestId()

    try {
      const rateLimit = await checkRateLimit(request, 'knowledge-detail')
      if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

      const userId = rateLimit.userId!
      const parsed = await parseRequest(v2DeleteKnowledgeDocumentContract, request, context, {
        validationErrorResponse: v2ValidationError,
      })
      if (!parsed.success) return parsed.response

      const { id: knowledgeBaseId, documentId } = parsed.data.params

      const result = await resolveKnowledgeBaseScoped(
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

      const doc = docs[0]
      if (!doc) return v2Error('NOT_FOUND', 'Document not found')

      await deleteDocument(documentId, requestId)

      recordAudit({
        workspaceId: parsed.data.query.workspaceId,
        actorId: userId,
        action: AuditAction.DOCUMENT_DELETED,
        resourceType: AuditResourceType.DOCUMENT,
        resourceId: documentId,
        resourceName: doc.filename,
        description: `Deleted document "${doc.filename}" from knowledge base via API`,
        metadata: { knowledgeBaseId },
        request,
      })

      return v2Data({ id: documentId, deleted: true as const }, { rateLimit })
    } catch (error) {
      logger.error(`[${requestId}] Error deleting document`, {
        error: getErrorMessage(error, 'Unknown error'),
      })
      return v2Error('INTERNAL_ERROR', 'Internal server error')
    }
  }
)
