import {
  createV2ResourceConcealmentPolicy,
  type InternalErrorPolicy,
  internalErrorResponse,
  internalPlainOrchestrationErrorPolicy,
  type V2ErrorPolicy,
  v2OrchestrationErrorPolicy,
} from '@/lib/api/server/routes'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { KnowledgeUsageLimitExceededError } from '@/lib/knowledge/application/billing'
import { KnowledgeDocumentUnsupportedMediaTypeError } from '@/lib/knowledge/application/upload-sessions'
import { v2Error } from '@/app/api/v2/lib/response'

function internalKnowledgeErrorPolicy(unhandledMessage: string): InternalErrorPolicy {
  return {
    project: internalPlainOrchestrationErrorPolicy.project,
    unhandled: () => internalErrorResponse(500, { error: unhandledMessage }),
  }
}

export const internalKnowledgeErrorPolicies = {
  list: internalKnowledgeErrorPolicy('Failed to fetch knowledge bases'),
  create: internalKnowledgeErrorPolicy('Failed to create knowledge base'),
} as const

const v2KnowledgeUsageErrorPolicy = {
  render(error) {
    if (error instanceof KnowledgeUsageLimitExceededError) {
      return v2Error('USAGE_LIMIT_EXCEEDED', error.message)
    }
    return v2OrchestrationErrorPolicy.render(error)
  },
} satisfies V2ErrorPolicy

export const v2KnowledgeErrorPolicies = {
  default: v2OrchestrationErrorPolicy,
  usage: v2KnowledgeUsageErrorPolicy,
  documentUpload: {
    render(error) {
      if (error instanceof KnowledgeDocumentUnsupportedMediaTypeError) {
        return v2Error('UNSUPPORTED_MEDIA_TYPE', error.message)
      }
      if (isPayloadSizeLimitError(error)) {
        return v2Error('PAYLOAD_TOO_LARGE', error.message)
      }
      return v2KnowledgeUsageErrorPolicy.render(error)
    },
  } satisfies V2ErrorPolicy,
  concealKnowledgeBaseAuthorization: createV2ResourceConcealmentPolicy({
    notFoundMessage: 'Knowledge base not found',
  }),
} as const
