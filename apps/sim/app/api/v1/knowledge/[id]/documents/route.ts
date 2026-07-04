import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { type NextRequest, NextResponse } from 'next/server'
import {
  v1ListKnowledgeDocumentsContract,
  v1UploadKnowledgeDocumentContract,
} from '@/lib/api/contracts/v1/knowledge'
import { parseRequest } from '@/lib/api/server'
import { checkActorUsageLimits } from '@/lib/billing/calculations/usage-monitor'
import { isPayloadSizeLimitError, readFormDataWithLimit } from '@/lib/core/utils/stream-limits'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  createSingleDocument,
  type DocumentData,
  getDocuments,
  processDocumentsWithQueue,
} from '@/lib/knowledge/documents/service'
import type { DocumentSortField, SortOrder } from '@/lib/knowledge/documents/types'
import { uploadWorkspaceFile } from '@/lib/uploads/contexts/workspace'
import { validateFileType } from '@/lib/uploads/utils/validation'
import { handleError, resolveKnowledgeBase, serializeDate } from '@/app/api/v1/knowledge/utils'
import { authenticateRequest } from '@/app/api/v1/middleware'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const MAX_FILE_SIZE = 100 * 1024 * 1024 // 100MB
const MAX_MULTIPART_OVERHEAD_BYTES = 1024 * 1024

interface DocumentsRouteParams {
  params: Promise<{ id: string }>
}

/** GET /api/v1/knowledge/[id]/documents — List documents in a knowledge base. */
export const GET = withRouteHandler(async (request: NextRequest, context: DocumentsRouteParams) => {
  const auth = await authenticateRequest(request, 'knowledge-detail')
  if (auth instanceof NextResponse) return auth
  const { requestId, userId, rateLimit } = auth

  try {
    const parsed = await parseRequest(v1ListKnowledgeDocumentsContract, request, context)
    if (!parsed.success) return parsed.response

    const { workspaceId, limit, offset, search, enabledFilter, sortBy, sortOrder } =
      parsed.data.query
    const { id: knowledgeBaseId } = parsed.data.params

    const result = await resolveKnowledgeBase(knowledgeBaseId, workspaceId, userId, rateLimit)
    if (result instanceof NextResponse) return result

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

    return NextResponse.json({
      success: true,
      data: {
        documents: documentsResult.documents.map((doc) => ({
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
        })),
        pagination: documentsResult.pagination,
      },
    })
  } catch (error) {
    return handleError(requestId, error, 'Failed to list documents')
  }
})

/** POST /api/v1/knowledge/[id]/documents — Upload a document to a knowledge base. */
export const POST = withRouteHandler(
  async (request: NextRequest, context: DocumentsRouteParams) => {
    const auth = await authenticateRequest(request, 'knowledge-detail')
    if (auth instanceof NextResponse) return auth
    const { requestId, userId, rateLimit } = auth

    try {
      const parsed = await parseRequest(v1UploadKnowledgeDocumentContract, request, context)
      if (!parsed.success) return parsed.response
      const { id: knowledgeBaseId } = parsed.data.params

      let formData: FormData
      try {
        formData = await readFormDataWithLimit(request, {
          maxBytes: MAX_FILE_SIZE + MAX_MULTIPART_OVERHEAD_BYTES,
          label: 'knowledge document upload body',
        })
      } catch (error) {
        if (isPayloadSizeLimitError(error)) {
          return NextResponse.json({ error: error.message }, { status: 413 })
        }
        return NextResponse.json(
          { error: 'Request body must be valid multipart form data' },
          { status: 400 }
        )
      }

      const rawFile = formData.get('file')
      const file = rawFile instanceof File ? rawFile : null
      const rawWorkspaceId = formData.get('workspaceId')
      const workspaceId = typeof rawWorkspaceId === 'string' ? rawWorkspaceId : null

      if (!workspaceId) {
        return NextResponse.json({ error: 'workspaceId form field is required' }, { status: 400 })
      }

      if (!file) {
        return NextResponse.json({ error: 'file form field is required' }, { status: 400 })
      }

      if (file.size > MAX_FILE_SIZE) {
        return NextResponse.json(
          {
            error: `File size exceeds 100MB limit (${(file.size / (1024 * 1024)).toFixed(2)}MB)`,
          },
          { status: 413 }
        )
      }

      const fileTypeError = validateFileType(file.name, file.type || '')
      if (fileTypeError) {
        return NextResponse.json({ error: fileTypeError.message }, { status: 415 })
      }

      const result = await resolveKnowledgeBase(
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
        return NextResponse.json(
          {
            error: usage.message || 'Usage limit exceeded. Please upgrade your plan to continue.',
          },
          { status: 402 }
        )
      }

      const buffer = Buffer.from(await file.arrayBuffer())
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
        // Processing errors are logged internally
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

      return NextResponse.json({
        success: true,
        data: {
          document: {
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
          },
          message: 'Document uploaded successfully. Processing will begin shortly.',
        },
      })
    } catch (error) {
      return handleError(requestId, error, 'Failed to upload document')
    }
  }
)
