import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import {
  type V2KnowledgeDocumentSummary,
  v2ListKnowledgeDocumentsContract,
  v2UploadKnowledgeDocumentContract,
} from '@/lib/api/contracts/v2/knowledge'
import { parseRequest } from '@/lib/api/server'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import type { JsonRouteContext } from '@/lib/api/server/routes/types'
import { admitV2Request, V2RouteInfrastructureError } from '@/lib/api/server/routes/v2-json-route'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { PlatformEvents } from '@/lib/core/telemetry'
import {
  isPayloadSizeLimitError,
  readFileToBufferWithLimit,
  readFormDataWithLimit,
} from '@/lib/core/utils/stream-limits'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { v2KnowledgeErrorPolicies } from '@/lib/knowledge/api/route-policies'
import { KnowledgeUsageLimitExceededError } from '@/lib/knowledge/application/billing'
import {
  admitKnowledgeDocumentUpload,
  listKnowledgeDocuments,
  uploadKnowledgeDocument,
} from '@/lib/knowledge/application/documents'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { captureServerEvent } from '@/lib/posthog/server'
import { uploadWorkspaceFile } from '@/lib/uploads/contexts/workspace'
import { MAX_KNOWLEDGE_DOCUMENT_FILE_SIZE } from '@/lib/uploads/shared/types'
import { validateFileType } from '@/lib/uploads/utils/validation'
import { serializeDate } from '@/app/api/v1/knowledge/utils'
import { decodeCursor, encodeCursor, v2Error, v2ValidationError } from '@/app/api/v2/lib/response'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const MAX_FILE_SIZE = MAX_KNOWLEDGE_DOCUMENT_FILE_SIZE
const MAX_MULTIPART_OVERHEAD_BYTES = 1024 * 1024

function toV2DocumentSummary(document: {
  id: string
  knowledgeBaseId: string
  filename: string
  fileSize: number
  mimeType: string
  processingStatus?: 'pending' | 'processing' | 'completed' | 'failed'
  chunkCount: number
  tokenCount: number
  characterCount: number
  enabled: boolean
  uploadedAt: Date
}): V2KnowledgeDocumentSummary {
  return {
    id: document.id,
    knowledgeBaseId: document.knowledgeBaseId,
    filename: document.filename,
    fileSize: document.fileSize,
    mimeType: document.mimeType,
    processingStatus: document.processingStatus ?? 'pending',
    chunkCount: document.chunkCount,
    tokenCount: document.tokenCount,
    characterCount: document.characterCount,
    enabled: document.enabled,
    createdAt: serializeDate(document.uploadedAt),
  }
}

/** GET /api/v2/knowledge/[id]/documents — List documents in a knowledge base. */
export const GET = defineV2JsonRoute({
  contract: v2ListKnowledgeDocumentsContract,
  auth: v2ApiKeyAuth,
  operation: knowledgeOperations.listDocuments,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2KnowledgeErrorPolicies.concealKnowledgeBaseAuthorization,
  mapInput: ({ params, query }) => {
    const decodedCursor = query.cursor ? decodeCursor<{ offset: number }>(query.cursor) : null
    if (
      query.cursor &&
      (!decodedCursor || !Number.isInteger(decodedCursor.offset) || decodedCursor.offset < 0)
    ) {
      throw new OrchestrationError('validation', 'Invalid cursor')
    }
    return {
      knowledgeBaseId: params.id,
      assertedWorkspaceId: query.workspaceId,
      enabledFilter: query.enabledFilter,
      search: query.search,
      limit: query.limit,
      offset: decodedCursor?.offset ?? 0,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
    }
  },
  useCase: listKnowledgeDocuments,
  present: ({ documents, pagination }) => ({
    data: documents.map(toV2DocumentSummary),
    nextCursor: pagination.hasMore
      ? encodeCursor({ offset: pagination.offset + pagination.limit })
      : null,
  }),
})

/** POST /api/v2/knowledge/[id]/documents — Upload a document to a knowledge base. */
export const POST = withRouteHandler<JsonRouteContext | undefined>(
  async (request: NextRequest, context) => {
    if (request.method !== v2UploadKnowledgeDocumentContract.method) {
      throw new Error(
        `Route received ${request.method} for ${v2UploadKnowledgeDocumentContract.method} contract ${v2UploadKnowledgeDocumentContract.path}`
      )
    }

    const routeAdmission = await admitV2Request(
      request,
      knowledgeOperations.uploadDocument,
      v2ApiKeyAuth,
      v2RateLimits.publicApi
    )
    if (!routeAdmission.success) return routeAdmission.response

    const parsed = await parseRequest(v2UploadKnowledgeDocumentContract, request, context ?? {}, {
      validationErrorResponse: v2ValidationError,
    })
    if (!parsed.success) return parsed.response

    const { principal } = routeAdmission.auth
    const { id: knowledgeBaseId } = parsed.data.params
    const { workspaceId } = parsed.data.query

    try {
      const uploadAdmission = await admitKnowledgeDocumentUpload.execute({
        principal,
        input: { knowledgeBaseId, assertedWorkspaceId: workspaceId },
        request,
      })

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
      if (!file) return v2Error('BAD_REQUEST', 'file form field is required')

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
        uploadAdmission.workspaceId,
        uploadAdmission.storageActorUserId,
        buffer,
        file.name,
        contentType
      )

      const result = await uploadKnowledgeDocument.execute({
        principal,
        input: {
          knowledgeBaseId,
          assertedWorkspaceId: workspaceId,
          document: {
            filename: file.name,
            fileUrl: uploadedFile.url,
            fileSize: file.size,
            mimeType: contentType,
          },
          startProcessing: true,
          usageAdmission: 'pre_admitted',
          source: 'api',
        },
        request,
      })

      PlatformEvents.knowledgeBaseDocumentsUploaded({
        knowledgeBaseId,
        documentsCount: 1,
        uploadType: 'single',
        mimeType: contentType,
        fileSize: file.size,
      })
      if (principal.kind === 'personal_api_key') {
        captureServerEvent(
          principal.userId,
          'knowledge_base_document_uploaded',
          {
            knowledge_base_id: knowledgeBaseId,
            workspace_id: workspaceId,
            document_count: 1,
            upload_type: 'single',
          },
          {
            groups: { workspace: workspaceId },
            setOnce: { first_document_uploaded_at: new Date().toISOString() },
          }
        )
      }

      const document = toV2DocumentSummary(result.document)
      const body = v2UploadKnowledgeDocumentContract.response.schema.parse({
        data: { document },
      })
      return NextResponse.json(body, {
        status: 201,
        headers: { 'Cache-Control': 'private, no-store' },
      })
    } catch (error) {
      if (error instanceof KnowledgeUsageLimitExceededError) {
        return v2Error('USAGE_LIMIT_EXCEEDED', error.message)
      }
      if (isPayloadSizeLimitError(error)) {
        return v2Error('PAYLOAD_TOO_LARGE', error.message)
      }
      const response = v2KnowledgeErrorPolicies.default.render(error)
      if (response) return response
      throw error
    }
  },
  {
    unhandledErrorResponse: ({ error }) =>
      error instanceof V2RouteInfrastructureError
        ? v2Error('SERVICE_UNAVAILABLE', 'Service temporarily unavailable')
        : v2Error('INTERNAL_ERROR', 'Internal server error'),
  }
)
