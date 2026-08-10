import { triggerKnowledgeConnectorSyncContract } from '@/lib/api/contracts/knowledge'
import { defineInternalJsonRoute, internalRateLimits } from '@/lib/api/server/routes'
import {
  internalKnowledgeAnalytics,
  resolveInternalKnowledgeBillingAttribution,
} from '@/lib/knowledge/api/internal-route'
import {
  internalKnowledgeErrorPolicies,
  internalKnowledgeSessionOrExecutorAuth,
} from '@/lib/knowledge/api/route-policies'
import { syncKnowledgeConnector } from '@/lib/knowledge/application/connectors'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'

export const POST = defineInternalJsonRoute({
  contract: triggerKnowledgeConnectorSyncContract,
  auth: internalKnowledgeSessionOrExecutorAuth,
  operation: knowledgeOperations.syncConnector,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve existing internal connector-sync behavior',
  }),
  errorPolicy: internalKnowledgeErrorPolicies.connectors,
  mapInput: ({ params, query }, { principal, request }) => ({
    connectorId: params.connectorId,
    knowledgeBaseId: params.id,
    rehydrate: query.rehydrate,
    resolveBillingAttribution: (workspaceId: string) =>
      resolveInternalKnowledgeBillingAttribution(request, principal, workspaceId),
    source: 'ui' as const,
  }),
  useCase: syncKnowledgeConnector,
  onSuccess: internalKnowledgeAnalytics.connectorSynced,
  present: () => ({ success: true as const, message: 'Sync triggered' }),
})
