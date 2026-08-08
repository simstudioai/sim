import {
  createV2ResourceConcealmentPolicy,
  type InternalErrorPolicy,
  internalErrorResponse,
  internalPlainOrchestrationErrorPolicy,
  v2OrchestrationErrorPolicy,
} from '@/lib/api/server/routes'

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

export const v2KnowledgeErrorPolicies = {
  default: v2OrchestrationErrorPolicy,
  concealKnowledgeBaseAuthorization: createV2ResourceConcealmentPolicy({
    notFoundMessage: 'Knowledge base not found',
  }),
} as const
