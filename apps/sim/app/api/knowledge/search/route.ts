import { searchWorkspaceKnowledgeContract } from '@/lib/api/contracts/knowledge'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalKnowledgeErrorPolicies } from '@/lib/knowledge/api/route-policies'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { searchLiveKnowledge } from '@/lib/sim-search/live/application'

export const POST = defineInternalJsonRoute({
  contract: searchWorkspaceKnowledgeContract,
  auth: internalSessionAuth,
  operation: knowledgeOperations.search,
  rateLimit: internalRateLimits.none({
    reason:
      'Provider limits apply independently to each user grant; requests have bounded fanout and deadlines',
  }),
  errorPolicy: internalKnowledgeErrorPolicies.search,
  mapInput: ({ body }, { request }) => ({ ...body, signal: request.signal }),
  useCase: searchLiveKnowledge,
  present: (data) => ({ success: true as const, data }),
})
