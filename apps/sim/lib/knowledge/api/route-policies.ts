import {
  createV2ResourceConcealmentPolicy,
  v2OrchestrationErrorPolicy,
} from '@/lib/api/server/routes'

export const v2KnowledgeErrorPolicies = {
  default: v2OrchestrationErrorPolicy,
  concealKnowledgeBaseAuthorization: createV2ResourceConcealmentPolicy({
    notFoundMessage: 'Knowledge base not found',
  }),
} as const
