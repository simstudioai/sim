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
  rateLimit: internalRateLimits.none({
    reason: 'Preserve existing internal connector listing behavior',
  }),
  errorPolicy: internalKnowledgeErrorPolicies.connectors,
  mapInput: ({ query }) => ({ workspaceId: query.workspaceId }),
  useCase: listWorkspaceMemberConnectors,
  present: ({ connectors }) => ({ success: true as const, data: connectors }),
})
