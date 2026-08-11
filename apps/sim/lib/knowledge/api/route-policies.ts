import {
  createInternalSessionOrExecutorAuth,
  createV2ResourceConcealmentPolicy,
  type InternalErrorPolicy,
  internalErrorResponse,
  internalPlainOrchestrationErrorPolicy,
  type V2ErrorPolicy,
  v2OrchestrationErrorPolicy,
} from '@/lib/api/server/routes'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { KNOWLEDGE_DELEGATION_AUDIENCE } from '@/lib/knowledge/application/authorization'
import { KnowledgeUsageLimitExceededError } from '@/lib/knowledge/application/billing'
import { KnowledgeSearchProvenanceUnavailableError } from '@/lib/knowledge/application/search'
import { KnowledgeDocumentUnsupportedMediaTypeError } from '@/lib/knowledge/application/upload-sessions'
import { v2Error } from '@/app/api/v2/lib/response'

function internalKnowledgeErrorPolicy(unhandledMessage: string): InternalErrorPolicy {
  return {
    project: internalPlainOrchestrationErrorPolicy.project,
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
    return internalPlainOrchestrationErrorPolicy.project(error)
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
    return internalPlainOrchestrationErrorPolicy.project(error)
  },
  unhandled: () => internalErrorResponse(500, { error: 'Failed to perform vector search' }),
}

export const internalKnowledgeSessionOrExecutorAuth = createInternalSessionOrExecutorAuth({
  audience: KNOWLEDGE_DELEGATION_AUDIENCE,
})

export const internalKnowledgeErrorPolicies = {
  list: internalKnowledgeErrorPolicy('Failed to fetch knowledge bases'),
  read: internalKnowledgeErrorPolicy('Failed to fetch knowledge base'),
  create: internalKnowledgeErrorPolicy('Failed to create knowledge base'),
  update: internalKnowledgeErrorPolicy('Failed to update knowledge base'),
  delete: internalKnowledgeErrorPolicy('Failed to delete knowledge base'),
  restore: internalKnowledgeErrorPolicy('Internal server error'),
  default: internalKnowledgeErrorPolicy('Internal server error'),
  documents: internalKnowledgeErrorPolicy('Failed to process knowledge document request'),
  chunks: internalKnowledgeErrorPolicy('Failed to process knowledge chunk request'),
  upsert: internalKnowledgeUploadErrorPolicy,
  search: internalKnowledgeSearchErrorPolicy,
  tags: internalKnowledgeErrorPolicy('Failed to process knowledge tag request'),
  connectors: internalKnowledgeErrorPolicy('Internal server error'),
  uploads: internalKnowledgeUploadErrorPolicy,
} as const

const v2KnowledgeUsageErrorPolicy = {
  render(error) {
    if (error instanceof KnowledgeUsageLimitExceededError) {
      return v2Error('USAGE_LIMIT_EXCEEDED', error.message)
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
  concealKnowledgeBaseUploadAuthorization: createV2ResourceConcealmentPolicy({
    notFoundMessage: 'Knowledge base not found',
    render: v2KnowledgeDocumentUploadErrorPolicy.render,
  }),
} as const
