import { nextAvailableSlotContract } from '@/lib/api/contracts/knowledge'
import { defineInternalJsonRoute, internalRateLimits } from '@/lib/api/server/routes'
import {
  internalKnowledgeErrorPolicies,
  internalKnowledgeSessionOrExecutorAuth,
} from '@/lib/knowledge/api/route-policies'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { readNextKnowledgeTagSlot } from '@/lib/knowledge/application/tags'

export const GET = defineInternalJsonRoute({
  contract: nextAvailableSlotContract,
  auth: internalKnowledgeSessionOrExecutorAuth,
  operation: knowledgeOperations.readNextTagSlot,
  rateLimit: internalRateLimits.none({ reason: 'Preserve existing internal tag-slot behavior' }),
  errorPolicy: internalKnowledgeErrorPolicies.tags,
  mapInput: ({ params, query }) => ({ knowledgeBaseId: params.id, fieldType: query.fieldType }),
  useCase: readNextKnowledgeTagSlot,
  present: (data) => ({ success: true as const, data }),
})
