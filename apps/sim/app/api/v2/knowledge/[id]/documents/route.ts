import {
  type V2KnowledgeDocumentSummary,
  v2ListKnowledgeDocumentsContract,
  v2UploadKnowledgeDocumentContract,
} from '@/lib/api/contracts/v2/knowledge'
import {
  defineV2BodyLifecycleRoute,
  defineV2JsonRoute,
  v2ApiKeyAuth,
  v2RateLimits,
} from '@/lib/api/server/routes'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { PlatformEvents } from '@/lib/core/telemetry'
import {
  isPayloadSizeLimitError,
  MAX_MULTIPART_OVERHEAD_BYTES,
  readFileToBufferWithLimit,
  readFormDataWithLimit,
} from '@/lib/core/utils/stream-limits'
import { v2KnowledgeErrorPolicies } from '@/lib/knowledge/api/route-policies'
import {
  admitKnowledgeDocumentUpload,
  listKnowledgeDocuments,
  uploadKnowledgeDocument,
} from '@/lib/knowledge/application/documents'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { KnowledgeDocumentUnsupportedMediaTypeError } from '@/lib/knowledge/application/upload-sessions'
import { captureServerEvent } from '@/lib/posthog/server'
import { MAX_KNOWLEDGE_DOCUMENT_FILE_SIZE } from '@/lib/uploads/shared/types'
import { validateFileType } from '@/lib/uploads/utils/validation'
import { serializeDate } from '@/app/api/v1/knowledge/utils'
import { decodeOffsetCursor, encodeCursor } from '@/app/api/v2/lib/response'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const MAX_FILE_SIZE = MAX_KNOWLEDGE_DOCUMENT_FILE_SIZE

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
  mapInput: ({ params, query }) => ({
    knowledgeBaseId: params.id,
    assertedWorkspaceId: query.workspaceId,
    enabledFilter: query.enabledFilter,
    search: query.search,
    limit: query.limit,
    offset: decodeOffsetCursor(query.cursor),
    sortBy: query.sortBy,
    sortOrder: query.sortOrder,
  }),
  useCase: listKnowledgeDocuments,
  present: ({ documents, pagination }) => ({
    data: documents.map(toV2DocumentSummary),
    nextCursor: pagination.hasMore
      ? encodeCursor({ offset: pagination.offset + pagination.limit })
      : null,
  }),
})

/** POST /api/v2/knowledge/[id]/documents — Upload a document to a knowledge base. */
export const POST = defineV2BodyLifecycleRoute({
  contract: v2UploadKnowledgeDocumentContract,
  auth: v2ApiKeyAuth,
  operation: knowledgeOperations.uploadDocument,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2KnowledgeErrorPolicies.concealKnowledgeBaseUploadAuthorization,
  admission: {
    mapInput: ({ params, query }) => ({
      knowledgeBaseId: params.id,
      assertedWorkspaceId: query.workspaceId,
    }),
    useCase: admitKnowledgeDocumentUpload,
  },
  async readBody({ request }) {
    let formData: FormData
    try {
      formData = await readFormDataWithLimit(request, {
        maxBytes: MAX_FILE_SIZE + MAX_MULTIPART_OVERHEAD_BYTES,
        label: 'knowledge document upload body',
      })
    } catch (error) {
      if (isPayloadSizeLimitError(error)) throw error
      throw new OrchestrationError('validation', 'Request body must be valid multipart form data')
    }

    const rawFile = formData.get('file')
    if (!(rawFile instanceof File)) {
      throw new OrchestrationError('validation', 'file form field is required')
    }
    if (rawFile.size > MAX_FILE_SIZE) {
      throw new OrchestrationError(
        'payload_too_large',
        `File size exceeds 100MB limit (${(rawFile.size / (1024 * 1024)).toFixed(2)}MB)`
      )
    }
    const contentType = rawFile.type || 'application/octet-stream'
    const fileTypeError = validateFileType(rawFile.name, rawFile.type || '')
    if (fileTypeError) {
      throw new KnowledgeDocumentUnsupportedMediaTypeError(fileTypeError.message)
    }
    const buffer = await readFileToBufferWithLimit(rawFile, {
      maxBytes: MAX_FILE_SIZE,
      label: 'knowledge document file',
    })
    return { file: rawFile, buffer, contentType }
  },
  mapInput: ({ parsed, body }) => ({
    knowledgeBaseId: parsed.params.id,
    assertedWorkspaceId: parsed.query.workspaceId,
    file: {
      buffer: body.buffer,
      filename: body.file.name,
      fileSize: body.file.size,
      mimeType: body.contentType,
    },
    startProcessing: true,
    usageAdmission: 'pre_admitted' as const,
    source: 'api' as const,
  }),
  useCase: uploadKnowledgeDocument,
  present: (result) => ({ data: toV2DocumentSummary(result.document) }),
  onSuccess: ({ principal, admission, result }) => {
    PlatformEvents.knowledgeBaseDocumentsUploaded({
      knowledgeBaseId: result.document.knowledgeBaseId,
      documentsCount: 1,
      uploadType: 'single',
      mimeType: result.document.mimeType,
      fileSize: result.document.fileSize,
    })
    if (principal.kind === 'personal_api_key') {
      captureServerEvent(
        principal.userId,
        'knowledge_base_document_uploaded',
        {
          knowledge_base_id: result.document.knowledgeBaseId,
          workspace_id: admission.workspaceId,
          document_count: 1,
          upload_type: 'single',
        },
        {
          groups: { workspace: admission.workspaceId },
          setOnce: { first_document_uploaded_at: new Date().toISOString() },
        }
      )
    }
  },
})
