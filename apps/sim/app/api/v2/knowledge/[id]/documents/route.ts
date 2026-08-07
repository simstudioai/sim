import { NextResponse } from 'next/server'
import {
  type V2KnowledgeDocumentSummary,
  v2ListKnowledgeDocumentsContract,
  v2UploadKnowledgeDocumentContract,
} from '@/lib/api/contracts/v2/knowledge'
import {
  checkAttributedUsageLimits,
  resolveBillingAttribution,
} from '@/lib/billing/core/billing-attribution'
import {
  isPayloadSizeLimitError,
  readFileToBufferWithLimit,
  readFormDataWithLimit,
} from '@/lib/core/utils/stream-limits'
import { getDocuments } from '@/lib/knowledge/documents/service'
import type { DocumentSortField, SortOrder } from '@/lib/knowledge/documents/types'
import { performUploadKnowledgeDocument } from '@/lib/knowledge/orchestration'
import type { KnowledgeBaseWithCounts } from '@/lib/knowledge/types'
import { uploadWorkspaceFile } from '@/lib/uploads/contexts/workspace'
import { MAX_KNOWLEDGE_DOCUMENT_FILE_SIZE } from '@/lib/uploads/shared/types'
import { validateFileType } from '@/lib/uploads/utils/validation'
import { withPublicApiRouteHandler } from '@/app/api/public-api-route-handler'
import { resolveKnowledgeBase, serializeDate } from '@/app/api/v1/knowledge/utils'
import type { RateLimitResult } from '@/app/api/v1/middleware'
import {
  decodeCursor,
  encodeCursor,
  v2CursorList,
  v2Data,
  v2Error,
  v2ErrorForOrchestration,
} from '@/app/api/v2/lib/response'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const MAX_FILE_SIZE = MAX_KNOWLEDGE_DOCUMENT_FILE_SIZE
const MAX_MULTIPART_OVERHEAD_BYTES = 1024 * 1024

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

/** GET /api/v2/knowledge/[id]/documents — List documents in a knowledge base. */
export const GET = withPublicApiRouteHandler({
  contract: v2ListKnowledgeDocumentsContract,
  rateLimitEndpoint: 'knowledge-detail',
  handler: async ({ input, auth: { requestId, userId, rateLimit } }) => {
    const { workspaceId, limit, cursor, search, enabledFilter, sortBy, sortOrder } = input.query
    const { id: knowledgeBaseId } = input.params

    const result = await resolveKnowledgeBaseScoped(
      knowledgeBaseId,
      workspaceId,
      userId,
      rateLimit,
      'read'
    )
    if (result instanceof NextResponse) return result

    const decodedCursor = cursor ? decodeCursor<{ offset: number }>(cursor) : null
    if (
      cursor &&
      (!decodedCursor || !Number.isInteger(decodedCursor.offset) || decodedCursor.offset < 0)
    ) {
      return v2Error('BAD_REQUEST', 'Invalid cursor')
    }
    const offset = decodedCursor?.offset ?? 0

    const documentsResult = await getDocuments(
      knowledgeBaseId,
      {
        enabledFilter: enabledFilter === 'all' ? undefined : enabledFilter,
        search,
        limit,
        offset,
        sortBy: sortBy as DocumentSortField,
        sortOrder: sortOrder as SortOrder,
      },
      requestId
    )

    const documents: V2KnowledgeDocumentSummary[] = documentsResult.documents.map((doc) => ({
      id: doc.id,
      knowledgeBaseId,
      filename: doc.filename,
      fileSize: doc.fileSize,
      mimeType: doc.mimeType,
      processingStatus: doc.processingStatus,
      chunkCount: doc.chunkCount,
      tokenCount: doc.tokenCount,
      characterCount: doc.characterCount,
      enabled: doc.enabled,
      createdAt: serializeDate(doc.uploadedAt),
    }))

    const nextCursor = documentsResult.pagination.hasMore
      ? encodeCursor({ offset: offset + limit })
      : null
    return v2CursorList(documents, nextCursor, { rateLimit })
  },
})

/**
 * POST /api/v2/knowledge/[id]/documents — Upload a document to a knowledge base.
 *
 * Authorization runs fully before the multipart body is buffered: the workspace
 * is a contract-validated query param (not a form field as in v1), so an
 * unauthorized caller never streams a file into memory. Order: rate limit →
 * KB ownership (write) → usage gate → buffered multipart read.
 */
export const POST = withPublicApiRouteHandler({
  contract: v2UploadKnowledgeDocumentContract,
  rateLimitEndpoint: 'knowledge-detail',
  handler: async ({ request, input, auth: { requestId, userId, rateLimit } }) => {
    try {
      const { id: knowledgeBaseId } = input.params
      const { workspaceId } = input.query

      const result = await resolveKnowledgeBaseScoped(
        knowledgeBaseId,
        workspaceId,
        userId,
        rateLimit,
        'write'
      )
      if (result instanceof NextResponse) return result

      /**
       * Gate before storage and indexing. Workspace keys use the billed account
       * and immutable payer from one read; personal keys preserve their human actor.
       */
      const billingAttribution =
        rateLimit.keyType === 'workspace'
          ? rateLimit.billingAttribution
          : await resolveBillingAttribution({ actorUserId: userId, workspaceId })
      if (!billingAttribution || billingAttribution.workspaceId !== workspaceId) {
        throw new Error('Workspace API request is missing its billing attribution')
      }
      const usage = await checkAttributedUsageLimits(billingAttribution)
      if (usage.isExceeded) {
        return v2Error(
          'USAGE_LIMIT_EXCEEDED',
          usage.message || 'Usage limit exceeded. Please upgrade your plan to continue.'
        )
      }

      let formData: FormData
      try {
        formData = await readFormDataWithLimit(request, {
          maxBytes: MAX_FILE_SIZE + MAX_MULTIPART_OVERHEAD_BYTES,
          label: 'knowledge document upload body',
        })
      } catch (error) {
        if (isPayloadSizeLimitError(error)) {
          return v2Error('PAYLOAD_TOO_LARGE', error.message)
        }
        return v2Error('BAD_REQUEST', 'Request body must be valid multipart form data')
      }

      const rawFile = formData.get('file')
      const file = rawFile instanceof File ? rawFile : null
      if (!file) {
        return v2Error('BAD_REQUEST', 'file form field is required')
      }

      if (file.size > MAX_FILE_SIZE) {
        return v2Error(
          'PAYLOAD_TOO_LARGE',
          `File size exceeds 100MB limit (${(file.size / (1024 * 1024)).toFixed(2)}MB)`
        )
      }

      const fileTypeError = validateFileType(file.name, file.type || '')
      if (fileTypeError) {
        return v2Error('UNSUPPORTED_MEDIA_TYPE', fileTypeError.message)
      }

      const buffer = await readFileToBufferWithLimit(file, {
        maxBytes: MAX_FILE_SIZE,
        label: 'knowledge document file',
      })
      const contentType = file.type || 'application/octet-stream'

      const uploadedFile = await uploadWorkspaceFile(
        workspaceId,
        userId,
        buffer,
        file.name,
        contentType
      )

      const outcome = await performUploadKnowledgeDocument({
        knowledgeBase: { id: knowledgeBaseId, name: result.kb.name, workspaceId },
        document: {
          filename: file.name,
          fileUrl: uploadedFile.url,
          fileSize: file.size,
          mimeType: contentType,
        },
        startProcessing: 'queue',
        billingAttribution,
        uploadedBy: billingAttribution.actorUserId,
        userId,
        source: 'api',
        requestId,
        request,
      })
      if (!outcome.success) {
        return v2ErrorForOrchestration(outcome.errorCode, outcome.error)
      }
      const newDocument = outcome.document

      const document: V2KnowledgeDocumentSummary = {
        id: newDocument.id,
        knowledgeBaseId,
        filename: newDocument.filename,
        fileSize: newDocument.fileSize,
        mimeType: newDocument.mimeType,
        processingStatus: 'pending',
        chunkCount: 0,
        tokenCount: 0,
        characterCount: 0,
        enabled: newDocument.enabled,
        createdAt: serializeDate(newDocument.uploadedAt),
      }

      return v2Data({ document }, { rateLimit, status: 201 })
    } catch (error) {
      if (isPayloadSizeLimitError(error)) {
        return v2Error('PAYLOAD_TOO_LARGE', error.message)
      }

      throw error
    }
  },
})
