import { v2SyncKnowledgeConnectorContract } from '@/lib/api/contracts/v2/knowledge'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { internalKnowledgeAnalytics } from '@/lib/knowledge/api/internal-route'
import { v2KnowledgeErrorPolicies } from '@/lib/knowledge/api/route-policies'
import { syncKnowledgeConnector } from '@/lib/knowledge/application/connectors'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'

export const POST = defineV2JsonRoute({
  contract: v2SyncKnowledgeConnectorContract,
  auth: v2ApiKeyAuth,
  operation: knowledgeOperations.syncConnector,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2KnowledgeErrorPolicies.concealKnowledgeBaseAuthorization,
  mapInput: ({ params, body }) => ({
    knowledgeBaseId: params.knowledgeBaseId,
    connectorId: params.connectorId,
    assertedWorkspaceId: body.workspaceId,
    rehydrate: body.rehydrate,
    source: 'api' as const,
  }),
  useCase: syncKnowledgeConnector,
  onSuccess: internalKnowledgeAnalytics.connectorSynced,
  present: ({ connectorId }) => ({ data: { id: connectorId, syncTriggered: true as const } }),
})
