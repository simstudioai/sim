import {
  createInternalResourceConcealmentPolicy,
  createInternalSessionOrExecutorAuth,
  createV2ResourceConcealmentPolicy,
  extendInternalErrorPolicy,
  type InternalErrorPolicy,
  internalErrorResponse,
  internalOrchestrationErrorPolicy,
  type V2ErrorPolicy,
  v2OrchestrationErrorPolicy,
} from '@/lib/api/server/routes'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { KNOWLEDGE_DELEGATION_AUDIENCE } from '@/lib/knowledge/application/authorization'
import { KnowledgeUsageLimitExceededError } from '@/lib/knowledge/application/billing'
import { KnowledgeDocumentNotReadyError } from '@/lib/knowledge/application/chunk-errors'
import { KnowledgeSearchProvenanceUnavailableError } from '@/lib/knowledge/application/search'
import { KnowledgeDocumentUnsupportedMediaTypeError } from '@/lib/knowledge/application/upload-sessions'
import { v2Error } from '@/app/api/v2/lib/response'

function internalKnowledgeErrorPolicy(unhandledMessage: string): InternalErrorPolicy {
  return {
    project: internalOrchestrationErrorPolicy.project,
    unhandled: () => internalErrorResponse(500, { error: unhandledMessage }),
  }
}

const internalKnowledgeUploadErrorPolicy: InternalErrorPolicy = {
  project(error) {
    if (error instanceof KnowledgeDocumentUnsupportedMediaTypeError) {
      return internalErrorResponse(415, { error: error.message })
    }
    if (error instanceof KnowledgeUsageLimitExceededError) {
      return internalErrorResponse(402, { error: error.message })
    }
    return internalOrchestrationErrorPolicy.project(error)
  },
  unhandled: () =>
    internalErrorResponse(500, { error: 'Failed to process knowledge upload request' }),
}

const internalKnowledgeSearchErrorPolicy: InternalErrorPolicy = {
  project(error) {
    if (error instanceof KnowledgeUsageLimitExceededError) {
      return internalErrorResponse(402, { error: error.message })
    }
    if (error instanceof KnowledgeSearchProvenanceUnavailableError) {
      return internalErrorResponse(422, { error: error.message })
    }
    return internalOrchestrationErrorPolicy.project(error)
  },
  unhandled: () => internalErrorResponse(500, { error: 'Failed to perform vector search' }),
}

export const internalKnowledgeSessionOrExecutorAuth = createInternalSessionOrExecutorAuth({
  audience: KNOWLEDGE_DELEGATION_AUDIENCE,
})

export const KNOWLEDGE_BASE_NOT_FOUND_MESSAGE = 'Knowledge base not found'

/**
 * Conceals a knowledge-base-scoped internal policy the way the v2 knowledge
 * routes conceal theirs. The workspace-level `list` and `create` policies are
 * deliberately left alone: neither names a knowledge base, so there is no
 * resource whose existence a 403 could betray.
 */
function concealKnowledgeBase(base: InternalErrorPolicy): InternalErrorPolicy {
  return createInternalResourceConcealmentPolicy({
    base,
    notFoundMessage: KNOWLEDGE_BASE_NOT_FOUND_MESSAGE,
  })
}

export const internalKnowledgeErrorPolicies = {
  list: internalKnowledgeErrorPolicy('Failed to fetch knowledge bases'),
  read: concealKnowledgeBase(internalKnowledgeErrorPolicy('Failed to fetch knowledge base')),
  export: concealKnowledgeBase(internalKnowledgeErrorPolicy('Failed to export knowledge base')),
  create: internalKnowledgeErrorPolicy('Failed to create knowledge base'),
  update: concealKnowledgeBase(internalKnowledgeErrorPolicy('Failed to update knowledge base')),
  delete: concealKnowledgeBase(internalKnowledgeErrorPolicy('Failed to delete knowledge base')),
  restore: concealKnowledgeBase(internalKnowledgeErrorPolicy('Internal server error')),
  /**
   * Workspace-scoped bulk routes. Deliberately not concealed: the request names
   * a workspace, not one knowledge base, and per-item authorization failures
   * are already folded into the response's `notFound` list by the use case.
   */
  bulkMove: internalKnowledgeErrorPolicy('Failed to move knowledge bases'),
  bulkDelete: internalKnowledgeErrorPolicy('Failed to delete knowledge bases'),
  default: internalKnowledgeErrorPolicy('Internal server error'),
  documents: concealKnowledgeBase(
    internalKnowledgeErrorPolicy('Failed to process knowledge document request')
  ),
  chunks: concealKnowledgeBase(
    internalKnowledgeErrorPolicy('Failed to process knowledge chunk request')
  ),
  chunkList: concealKnowledgeBase(
    extendInternalErrorPolicy(
      internalKnowledgeErrorPolicy('Failed to process knowledge chunk request'),
      (error) =>
        error instanceof KnowledgeDocumentNotReadyError
          ? internalErrorResponse(400, {
              error: 'Document is not ready for access',
              details: `Document status: ${error.processingStatus}`,
              retryAfter: error.processingStatus === 'processing' ? 5 : null,
            })
          : null
    )
  ),
  upsert: concealKnowledgeBase(internalKnowledgeUploadErrorPolicy),
  search: concealKnowledgeBase(internalKnowledgeSearchErrorPolicy),
  tags: concealKnowledgeBase(
    internalKnowledgeErrorPolicy('Failed to process knowledge tag request')
  ),
  connectors: concealKnowledgeBase(internalKnowledgeErrorPolicy('Internal server error')),
  uploads: concealKnowledgeBase(internalKnowledgeUploadErrorPolicy),
} as const

const v2KnowledgeUsageErrorPolicy = {
  render(error) {
    if (error instanceof KnowledgeUsageLimitExceededError) {
      return v2Error('USAGE_LIMIT_EXCEEDED', error.message)
    }
    if (error instanceof KnowledgeSearchProvenanceUnavailableError) {
      return v2Error('CONFLICT', error.message)
    }
    return v2OrchestrationErrorPolicy.render(error)
  },
} satisfies V2ErrorPolicy

const v2KnowledgeDocumentUploadErrorPolicy = {
  render(error) {
    if (error instanceof KnowledgeDocumentUnsupportedMediaTypeError) {
      return v2Error('UNSUPPORTED_MEDIA_TYPE', error.message)
    }
    if (isPayloadSizeLimitError(error)) {
      return v2Error('PAYLOAD_TOO_LARGE', error.message)
    }
    return v2KnowledgeUsageErrorPolicy.render(error)
  },
} satisfies V2ErrorPolicy

/**
 * A chunk read or write whose document has not finished processing.
 *
 * `409`, not the internal surface's `400`: the request is well-formed and the
 * resource state is what refuses it. Per the v2 conventions a `409` carries no
 * `Retry-After` — waiting is not what fixes a `failed` document — so the
 * internal policy's `retryAfter` field is deliberately not carried over. The
 * status the document is in rides in the message, which is what tells a caller
 * whether to poll or to requeue.
 */
const v2KnowledgeChunkErrorPolicy = {
  render(error) {
    if (error instanceof KnowledgeDocumentNotReadyError) {
      return v2Error('CONFLICT', error.message)
    }
    return v2OrchestrationErrorPolicy.render(error)
  },
} satisfies V2ErrorPolicy

export const v2KnowledgeErrorPolicies = {
  default: v2OrchestrationErrorPolicy,
  usage: v2KnowledgeUsageErrorPolicy,
  documentUpload: v2KnowledgeDocumentUploadErrorPolicy,
  concealKnowledgeBaseAuthorization: createV2ResourceConcealmentPolicy({
    notFoundMessage: 'Knowledge base not found',
  }),
  concealKnowledgeBaseUsageAuthorization: createV2ResourceConcealmentPolicy({
    notFoundMessage: 'Knowledge base not found',
    render: v2KnowledgeUsageErrorPolicy.render,
  }),
  concealKnowledgeChunkAuthorization: createV2ResourceConcealmentPolicy({
    notFoundMessage: 'Knowledge base not found',
    render: v2KnowledgeChunkErrorPolicy.render,
  }),
  concealKnowledgeBaseUploadAuthorization: createV2ResourceConcealmentPolicy({
    notFoundMessage: 'Knowledge base not found',
    render: v2KnowledgeDocumentUploadErrorPolicy.render,
  }),
} as const
