import {
  listSearchIntegrationsContract,
  updateSearchIntegrationContract,
} from '@/lib/api/contracts/knowledge/search-integrations'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalKnowledgeErrorPolicies } from '@/lib/knowledge/api/route-policies'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import {
  approveSearchIntegration,
  listSearchIntegrations,
} from '@/lib/knowledge/application/search-integrations'

export const GET = defineInternalJsonRoute({
  contract: listSearchIntegrationsContract,
  auth: internalSessionAuth,
  operation: knowledgeOperations.listSearchIntegrations,
  rateLimit: internalRateLimits.user({ bucketName: 'knowledge.search.integrations.list' }),
  errorPolicy: internalKnowledgeErrorPolicies.connectors,
  mapInput: ({ query }) => query,
  useCase: listSearchIntegrations,
  present: (data) => ({ success: true as const, data }),
})

export const PUT = defineInternalJsonRoute({
  contract: updateSearchIntegrationContract,
  auth: internalSessionAuth,
  operation: knowledgeOperations.approveSearchIntegration,
  rateLimit: internalRateLimits.user({ bucketName: 'knowledge.search.integrations.approve' }),
  errorPolicy: internalKnowledgeErrorPolicies.connectors,
  mapInput: ({ body }) => body,
  useCase: approveSearchIntegration,
  present: ({ connectorType, approved }) => ({
    success: true as const,
    data: { connectorType, approved },
  }),
})
