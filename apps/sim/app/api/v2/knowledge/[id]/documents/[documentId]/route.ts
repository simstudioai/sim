import { NextResponse } from 'next/server'
import {
  type V2KnowledgeDocument,
  v2DeleteKnowledgeDocumentContract,
  v2GetKnowledgeDocumentContract,
} from '@/lib/api/contracts/v2/knowledge'
import { getKnowledgeDocument } from '@/lib/knowledge/documents/service'
import { performDeleteKnowledgeDocument } from '@/lib/knowledge/orchestration'
import type { KnowledgeBaseWithCounts } from '@/lib/knowledge/types'
import { withPublicApiRouteHandler } from '@/app/api/public-api-route-handler'
import { resolveKnowledgeBase, serializeDate } from '@/app/api/v1/knowledge/utils'
import type { RateLimitResult } from '@/app/api/v1/middleware'
import { v2Data, v2Error, v2ErrorForOrchestration } from '@/app/api/v2/lib/response'

export const dynamic = 'force-dynamic'
export const revalidate = 0

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
export const GET = withPublicApiRouteHandler({
  contract: v2GetKnowledgeDocumentContract,
  rateLimitEndpoint: 'knowledge-detail',
  handler: async ({ input, auth: { userId, rateLimit } }) => {
    const { id: knowledgeBaseId, documentId } = input.params

    const result = await resolveKnowledgeBaseScoped(
      knowledgeBaseId,
      input.query.workspaceId,
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
  },
})

/** DELETE /api/v2/knowledge/[id]/documents/[documentId] — Delete a document. */
export const DELETE = withPublicApiRouteHandler({
  contract: v2DeleteKnowledgeDocumentContract,
  rateLimitEndpoint: 'knowledge-detail',
  handler: async ({ request, input, auth: { requestId, userId, rateLimit } }) => {
    const { id: knowledgeBaseId, documentId } = input.params

    const result = await resolveKnowledgeBaseScoped(
      knowledgeBaseId,
      input.query.workspaceId,
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
        workspaceId: input.query.workspaceId,
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
  },
})
