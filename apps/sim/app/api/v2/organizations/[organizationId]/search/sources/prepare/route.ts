import { v2PrepareSearchSourcesContract } from '@/lib/api/contracts/v2/search-sources'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2OrganizationErrorPolicy } from '@/lib/api/server/routes/organizations'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { prepareSearchSource } from '@/lib/knowledge/application/sim-search'

export const POST = defineV2JsonRoute({
  contract: v2PrepareSearchSourcesContract,
  operation: knowledgeOperations.prepareSearchSource,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrganizationErrorPolicy,
  mapInput: ({ params, body }) => ({ ...params, ...body }),
  useCase: prepareSearchSource,
  present: () => ({ data: { ready: true as const } }),
})
