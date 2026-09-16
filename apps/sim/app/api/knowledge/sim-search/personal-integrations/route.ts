import {
  connectPersonalSearchIntegrationContract,
  listPersonalSearchIntegrationsContract,
} from '@/lib/api/contracts/knowledge/personal-integrations'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalKnowledgeErrorPolicies } from '@/lib/knowledge/api/route-policies'
import { connectPersonalSearchIntegration } from '@/lib/knowledge/application/connect-personal-search-integration'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { listPersonalSearchIntegrations } from '@/lib/knowledge/application/personal-search-integrations'

export const GET = defineInternalJsonRoute({
  contract: listPersonalSearchIntegrationsContract,
  auth: internalSessionAuth,
  operation: knowledgeOperations.listPersonalSearchIntegrations,
  rateLimit: internalRateLimits.user({ bucketName: 'knowledge.search.personal-integrations.list' }),
  errorPolicy: internalKnowledgeErrorPolicies.connectors,
  mapInput: ({ query }) => query,
  useCase: listPersonalSearchIntegrations,
  present: (data) => ({ success: true as const, data }),
})

export const POST = defineInternalJsonRoute({
  contract: connectPersonalSearchIntegrationContract,
  auth: internalSessionAuth,
  operation: knowledgeOperations.connectPersonalSearchIntegration,
  rateLimit: internalRateLimits.user({
    bucketName: 'knowledge.search.personal-integrations.connect',
  }),
  errorPolicy: internalKnowledgeErrorPolicies.connectAccount,
  mapInput: ({ body }) => body,
  useCase: connectPersonalSearchIntegration,
  present: (data) => ({ success: true as const, data }),
})
