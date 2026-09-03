import { listWorkspaceMemberConnectorsContract } from '@/lib/api/contracts/knowledge'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalKnowledgeErrorPolicies } from '@/lib/knowledge/api/route-policies'
import { listWorkspaceMemberConnectors } from '@/lib/knowledge/application/connectors'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'

export const GET = defineInternalJsonRoute({
  contract: listWorkspaceMemberConnectorsContract,
  auth: internalSessionAuth,
  operation: knowledgeOperations.listWorkspaceMemberConnectors,
  rateLimit: internalRateLimits.none({ reason: 'One small read per visit to the Search tab' }),
  errorPolicy: internalKnowledgeErrorPolicies.memberConnectors,
  mapInput: ({ query }) => ({ workspaceId: query.workspaceId }),
  useCase: listWorkspaceMemberConnectors,
  present: ({ connectors }) => ({ success: true as const, data: connectors }),
})
