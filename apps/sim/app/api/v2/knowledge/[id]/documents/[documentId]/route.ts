import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import {
  type V2KnowledgeDocument,
  v2DeleteKnowledgeDocumentContract,
  v2GetKnowledgeDocumentContract,
} from '@/lib/api/contracts/v2/knowledge'
import { parseRequest } from '@/lib/api/server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getKnowledgeDocument } from '@/lib/knowledge/documents/service'
import { performDeleteKnowledgeDocument } from '@/lib/knowledge/orchestration'
import type { KnowledgeBaseWithCounts } from '@/lib/knowledge/types'
import { resolveKnowledgeBase, serializeDate } from '@/app/api/v1/knowledge/utils'
import { checkRateLimit, type RateLimitResult } from '@/app/api/v1/middleware'
import { v2ApiGateError } from '@/app/api/v2/lib/gate'
import {
  v2Data,
  v2Error,
  v2ErrorForOrchestration,
  v2RateLimitError,
  v2ValidationError,
} from '@/app/api/v2/lib/response'

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

      const gate = await v2ApiGateError(userId)
      if (gate) return gate

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

      const doc = await getKnowledgeDocument(knowledgeBaseId, documentId)
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

      const gate = await v2ApiGateError(userId)
      if (gate) return gate

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

      const doc = await getKnowledgeDocument(knowledgeBaseId, documentId)
      if (!doc) return v2Error('NOT_FOUND', 'Document not found')

      const outcome = await performDeleteKnowledgeDocument({
        knowledgeBase: {
          id: knowledgeBaseId,
          name: result.kb.name,
          workspaceId: parsed.data.query.workspaceId,
        },
        document: { id: documentId, filename: doc.filename },
        userId,
        source: 'api',
        requestId,
        request,
      })
      if (!outcome.success) {
        return v2ErrorForOrchestration(outcome.errorCode, outcome.error)
      }

      return v2Data({ id: documentId, deleted: true as const }, { rateLimit })
    } catch (error) {
      logger.error(`[${requestId}] Error deleting document`, {
        error: getErrorMessage(error, 'Unknown error'),
      })
      return v2Error('INTERNAL_ERROR', 'Internal server error')
    }
  }
)
