import { searchSimSearchSlackContract } from '@/lib/api/contracts/knowledge'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalKnowledgeErrorPolicies } from '@/lib/knowledge/api/route-policies'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { searchSimSearchSlack } from '@/lib/knowledge/application/sim-search'

export const POST = defineInternalJsonRoute({
  contract: searchSimSearchSlackContract,
  auth: internalSessionAuth,
  operation: knowledgeOperations.simSearchFederated,
  rateLimit: internalRateLimits.none({
    reason:
      "Slack's own per-user limit bounds this, and a failed call degrades to no Slack results",
  }),
  errorPolicy: internalKnowledgeErrorPolicies.search,
  mapInput: ({ body }) => ({
    workspaceId: body.workspaceId,
    query: body.query,
    limit: body.limit,
  }),
  useCase: searchSimSearchSlack,
  present: (result) => ({ success: true as const, data: result }),
})
