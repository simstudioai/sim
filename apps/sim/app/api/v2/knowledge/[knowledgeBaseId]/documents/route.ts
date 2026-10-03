import { isUserCredentialPrincipal } from '@sim/auth/principal'
import { omit } from '@sim/utils/object'
import {
  parseV2KnowledgeTagFiltersParam,
  v2BulkUpdateKnowledgeDocumentsContract,
  v2ListKnowledgeDocumentsContract,
  v2UploadKnowledgeDocumentContract,
} from '@/lib/api/contracts/v2/knowledge'
import { cursorRoute, cursorScopeKey, unorderedScopeOf } from '@/lib/api/cursor-binding'
import {
  defineV2BodyLifecycleRoute,
  defineV2JsonRoute,
  v2ApiKeyAuth,
  v2RateLimits,
} from '@/lib/api/server/routes'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { PlatformEvents } from '@/lib/core/telemetry'
import {
  isMultipartFieldValidationError,
  isPayloadSizeLimitError,
  MAX_MULTIPART_OVERHEAD_BYTES,
  readFileToBufferWithLimit,
  readFormDataWithLimit,
} from '@/lib/core/utils/stream-limits'
import { v2KnowledgeErrorPolicies } from '@/lib/knowledge/api/route-policies'
import {
  admitKnowledgeDocumentUpload,
  bulkUpdateKnowledgeDocuments,
  listKnowledgeDocuments,
  uploadKnowledgeDocument,
} from '@/lib/knowledge/application/documents'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { KnowledgeDocumentUnsupportedMediaTypeError } from '@/lib/knowledge/application/upload-sessions'
import { captureServerEvent } from '@/lib/posthog/server'
import { MAX_KNOWLEDGE_DOCUMENT_FILE_SIZE } from '@/lib/uploads/shared/types'
import { validateFileType } from '@/lib/uploads/utils/validation'
import { toV2DocumentSummary, toV2TaggedDocument } from '@/app/api/v2/knowledge/utils'
import { cursorSortKey, decodeOffsetCursor, encodeOffsetCursor } from '@/app/api/v2/lib/response'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const MAX_FILE_SIZE = MAX_KNOWLEDGE_DOCUMENT_FILE_SIZE

/**
 * Every param that changes which documents, in which order, this list returns.
 *
 * `tagFilters` binds through the contract's parser, not the raw query text: the
 * schema defaults `operator` to `eq`, so `{tagName}` and `{tagName, operator}`
 * are one filter to the query and must be one scope to the cursor. An
 * unparseable value binds raw — that request is about to 400 anyway.
 *
 * `fieldType` is dropped: `resolveKnowledgeTagFilters` builds every structured
 * filter with the stored definition's type and never reads the caller's, so
 * stating it or omitting it selects the same documents. A scope part the query
 * ignores refuses a cursor for a page that did not move.
 *
 * `workspaceId` is asserted scope rather than a filter, for the same reason as
 * on the sibling chunk list: the sequence is one knowledge base, named by the
 * path param this already binds, and authorization refuses any other workspace
 * before paging. Unlike that list it is nonetheless kept in the fingerprint —
 * see the note at the binding below. Dropping it would be correct in principle
 * and inert in effect, but it would refuse every cursor minted before the
 * change.
 */
function documentCursorFilters(
  knowledgeBaseId: string,
  query: { workspaceId: string; enabledFilter?: string; search?: string; tagFilters?: string }
) {
  const parsed = parseV2KnowledgeTagFiltersParam(query.tagFilters)
  return cursorScopeKey(cursorRoute(v2ListKnowledgeDocumentsContract, { knowledgeBaseId }), {
    // Kept in the fingerprint despite being asserted scope rather than a filter.
    // Dropping it is defensible in the abstract and free in effect — the value
    // is constant for any one sequence — but it changes the fingerprint, so
    // every cursor minted before the change is refused with a message telling
    // the caller they altered a filter they never sent. A constant costs
    // nothing to keep; a compatibility break to remove it buys nothing.
    workspaceId: query.workspaceId,
    enabledFilter: query.enabledFilter,
    search: query.search,
    tagFilters: parsed.success
      ? unorderedScopeOf(parsed.filters?.map((filter) => omit(filter, ['fieldType'])))
      : query.tagFilters,
  })
}

/** GET /api/v2/knowledge/[knowledgeBaseId]/documents — List documents in a knowledge base. */
export const GET = defineV2JsonRoute({
  contract: v2ListKnowledgeDocumentsContract,
  auth: v2ApiKeyAuth,
  operation: knowledgeOperations.listDocuments,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2KnowledgeErrorPolicies.concealKnowledgeBaseAuthorization,
  mapInput: ({ params, query }) => {
    const tagFilters = parseV2KnowledgeTagFiltersParam(query.tagFilters)
    if (!tagFilters.success) {
      throw new OrchestrationError('validation', tagFilters.message)
    }
    return {
      knowledgeBaseId: params.knowledgeBaseId,
      assertedWorkspaceId: query.workspaceId,
      enabledFilter: query.enabledFilter,
      search: query.search,
      limit: query.limit,
      offset: decodeOffsetCursor(
        query.cursor,
        cursorSortKey(query.sortBy, query.sortOrder),
        documentCursorFilters(params.knowledgeBaseId, query)
      ),
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
      tagNameFilters: tagFilters.filters,
    }
  },
  useCase: listKnowledgeDocuments,
  present: ({ documents, tagDefinitions, pagination }, { params, query }) => ({
    data: documents.map((document) => toV2TaggedDocument(document, tagDefinitions)),
    nextCursor: pagination.hasMore
      ? encodeOffsetCursor(
          cursorSortKey(query.sortBy, query.sortOrder),
          documentCursorFilters(params.knowledgeBaseId, query),
          pagination.offset + pagination.limit
        )
      : null,
  }),
})

/**
 * PATCH /api/v2/knowledge/[knowledgeBaseId]/documents — Enable or disable many documents.
 *
 * Enable and disable only. Bulk delete is deliberately not offered: the bulk
 * operation records no semantic audit, so a public bulk delete would empty a
 * knowledge base leaving no `DOCUMENT_DELETED` entries, while the per-document
 * DELETE audits every one.
 */
export const PATCH = defineV2JsonRoute({
  contract: v2BulkUpdateKnowledgeDocumentsContract,
  auth: v2ApiKeyAuth,
  operation: knowledgeOperations.bulkDocuments,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2KnowledgeErrorPolicies.concealKnowledgeBaseAuthorization,
  mapInput: ({ params, body }) => ({
    knowledgeBaseId: params.knowledgeBaseId,
    assertedWorkspaceId: body.workspaceId,
    operation: body.operation,
    documentIds: body.documentIds,
    selectAll: body.selectAll,
    enabledFilter: body.enabledFilter,
  }),
  useCase: bulkUpdateKnowledgeDocuments,
  present: (result) => {
    if (result.operation === 'delete') {
      throw new Error('Bulk knowledge document delete is not exposed on the public API')
    }
    /**
     * `documentIds` is echoed only for an explicit-list request, which the body
     * bounds. A `selectAll` request has no such bound: a knowledge base with
     * 100k documents would otherwise materialize and element-wise validate a
     * multi-megabyte identifier array nobody asked for. That caller reads
     * `updatedCount` and re-lists if it needs the identifiers.
     */
    return {
      data: {
        operation: result.operation,
        updatedCount: result.successCount,
        documentIds: result.selectAll
          ? undefined
          : result.updatedDocuments.map((document) => document.id),
      },
    }
  },
})

/** POST /api/v2/knowledge/[knowledgeBaseId]/documents — Upload a document to a knowledge base. */
export const POST = defineV2BodyLifecycleRoute({
  contract: v2UploadKnowledgeDocumentContract,
  auth: v2ApiKeyAuth,
  operation: knowledgeOperations.uploadDocument,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2KnowledgeErrorPolicies.concealKnowledgeBaseUploadAuthorization,
  admission: {
    mapInput: ({ params, query }) => ({
      knowledgeBaseId: params.knowledgeBaseId,
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
      if (isMultipartFieldValidationError(error)) {
        throw new OrchestrationError('validation', error.message)
      }
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
    knowledgeBaseId: parsed.params.knowledgeBaseId,
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
    if (isUserCredentialPrincipal(principal)) {
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
