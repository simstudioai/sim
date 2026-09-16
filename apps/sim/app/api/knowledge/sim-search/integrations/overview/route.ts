import { readOrganizationSearchOverviewContract } from '@/lib/api/contracts/knowledge/connectors'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalKnowledgeErrorPolicies } from '@/lib/knowledge/api/route-policies'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { readOrganizationSearchOverview } from '@/lib/knowledge/application/organization-search-overview'

export const GET = defineInternalJsonRoute({
  contract: readOrganizationSearchOverviewContract,
  auth: internalSessionAuth,
  operation: knowledgeOperations.readOrganizationSearchOverview,
  rateLimit: internalRateLimits.none({
    reason: 'Bounded provider operational aggregates for organization integration settings',
  }),
  errorPolicy: internalKnowledgeErrorPolicies.connectors,
  mapInput: ({ query }) => query,
  useCase: readOrganizationSearchOverview,
  present: (overview) => ({ success: true as const, data: overview }),
  staticResponseHeaders: { 'Cache-Control': 'private, no-store' },
})
