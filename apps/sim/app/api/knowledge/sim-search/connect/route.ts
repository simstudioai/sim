import { connectSimSearchConnectorContract } from '@/lib/api/contracts/knowledge'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalKnowledgeErrorPolicies } from '@/lib/knowledge/api/route-policies'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { connectSimSearchConnector } from '@/lib/knowledge/application/sim-search'

export const POST = defineInternalJsonRoute({
  contract: connectSimSearchConnectorContract,
  auth: internalSessionAuth,
  operation: knowledgeOperations.simSearchConnect,
  rateLimit: internalRateLimits.none({ reason: 'One click per source; mints a single-use link' }),
  errorPolicy: internalKnowledgeErrorPolicies.connectors,
  mapInput: ({ body }) => body,
  useCase: connectSimSearchConnector,
  present: (result) => ({ success: true as const, data: result }),
})
