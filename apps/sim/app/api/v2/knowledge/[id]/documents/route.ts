import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import {
  type V2KnowledgeDocumentSummary,
  v2ListKnowledgeDocumentsContract,
  v2UploadKnowledgeDocumentContract,
} from '@/lib/api/contracts/v2/knowledge'
import { parseRequest } from '@/lib/api/server'
import { checkActorUsageLimits } from '@/lib/billing/calculations/usage-monitor'
import { generateRequestId } from '@/lib/core/utils/request'
import {
  isPayloadSizeLimitError,
  readFileToBufferWithLimit,
  readFormDataWithLimit,
} from '@/lib/core/utils/stream-limits'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  createSingleDocument,
  type DocumentData,
  getDocuments,
  processDocumentsWithQueue,
} from '@/lib/knowledge/documents/service'
import type { DocumentSortField, SortOrder } from '@/lib/knowledge/documents/types'
import type { KnowledgeBaseWithCounts } from '@/lib/knowledge/types'
import { uploadWorkspaceFile } from '@/lib/uploads/contexts/workspace'
import { validateFileType } from '@/lib/uploads/utils/validation'
import { resolveKnowledgeBase, serializeDate } from '@/app/api/v1/knowledge/utils'
import { checkRateLimit, type RateLimitResult } from '@/app/api/v1/middleware'
import {
  decodeCursor,
  encodeCursor,
  v2CursorList,
  v2Data,
  v2Error,
  v2RateLimitError,
  v2ValidationError,
} from '@/app/api/v2/lib/response'

const logger = createLogger('V2KnowledgeDocumentsAPI')

export const dynamic = 'force-dynamic'
export const revalidate = 0

const MAX_FILE_SIZE = 100 * 1024 * 1024
const MAX_MULTIPART_OVERHEAD_BYTES = 1024 * 1024

interface DocumentsRouteParams {
  params: Promise<{ id: string }>
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

/** GET /api/v2/knowledge/[id]/documents — List documents in a knowledge base. */
export const GET = withRouteHandler(async (request: NextRequest, context: DocumentsRouteParams) => {
  const requestId = generateRequestId()

  try {
    const rateLimit = await checkRateLimit(request, 'knowledge-detail')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!
    const parsed = await parseRequest(v2ListKnowledgeDocumentsContract, request, context, {
      validationErrorResponse: v2ValidationError,
    })
    if (!parsed.success) return parsed.response

    const { workspaceId, limit, cursor, search, enabledFilter, sortBy, sortOrder } =
      parsed.data.query
    const { id: knowledgeBaseId } = parsed.data.params

    const result = await resolveKnowledgeBaseScoped(
      knowledgeBaseId,
      workspaceId,
      userId,
      rateLimit,
      'read'
    )
    if (result instanceof NextResponse) return result

    // Opaque cursor encodes the underlying offset (upgradeable to keyset later).
    const offset = cursor ? (decodeCursor<{ offset: number }>(cursor)?.offset ?? 0) : 0

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
  } catch (error) {
    logger.error(`[${requestId}] Error listing documents`, {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})

/**
 * POST /api/v2/knowledge/[id]/documents — Upload a document to a knowledge base.
 *
 * Authorization runs fully before the multipart body is buffered: the workspace
 * is a contract-validated query param (not a form field as in v1), so an
 * unauthorized caller never streams a file into memory. Order: rate limit →
 * KB ownership (write) → usage gate → buffered multipart read.
 */
export const POST = withRouteHandler(
  async (request: NextRequest, context: DocumentsRouteParams) => {
    const requestId = generateRequestId()

    try {
      const rateLimit = await checkRateLimit(request, 'knowledge-detail')
      if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

      const userId = rateLimit.userId!
      const parsed = await parseRequest(v2UploadKnowledgeDocumentContract, request, context, {
        validationErrorResponse: v2ValidationError,
      })
      if (!parsed.success) return parsed.response

      const { id: knowledgeBaseId } = parsed.data.params
      const { workspaceId } = parsed.data.query

      const result = await resolveKnowledgeBaseScoped(
        knowledgeBaseId,
        workspaceId,
        userId,
        rateLimit,
        'write'
      )
      if (result instanceof NextResponse) return result

      // Fast usage gate before the storage write + indexing (the async backstop
      // in processDocumentAsync still covers non-HTTP paths).
      const usage = await checkActorUsageLimits(userId, workspaceId)
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

      const newDocument = await createSingleDocument(
        {
          filename: file.name,
          fileUrl: uploadedFile.url,
          fileSize: file.size,
          mimeType: contentType,
        },
        knowledgeBaseId,
        requestId,
        userId
      )

      const documentData: DocumentData = {
        documentId: newDocument.id,
        filename: file.name,
        fileUrl: uploadedFile.url,
        fileSize: file.size,
        mimeType: contentType,
      }

      processDocumentsWithQueue([documentData], knowledgeBaseId, {}, requestId).catch(() => {
        // Processing errors are logged internally by the queue.
      })

      recordAudit({
        workspaceId,
        actorId: userId,
        action: AuditAction.DOCUMENT_UPLOADED,
        resourceType: AuditResourceType.DOCUMENT,
        resourceId: newDocument.id,
        resourceName: file.name,
        description: `Uploaded document "${file.name}" to knowledge base via API`,
        metadata: { knowledgeBaseId, fileSize: file.size, mimeType: contentType },
        request,
      })

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

      if (error instanceof Error) {
        if (
          error.message.includes('Storage limit exceeded') ||
          error.message.includes('storage limit')
        ) {
          return v2Error('PAYLOAD_TOO_LARGE', 'Storage limit exceeded')
        }
        if (error.message.includes('already exists')) {
          return v2Error('CONFLICT', 'Resource already exists')
        }
      }

      logger.error(`[${requestId}] Error uploading document`, {
        error: getErrorMessage(error, 'Unknown error'),
      })
      return v2Error('INTERNAL_ERROR', 'Internal server error')
    }
  }
)
