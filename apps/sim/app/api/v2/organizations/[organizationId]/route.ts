import { v2GetOrganizationContract } from '@/lib/api/contracts/v2/organizations'
import { presentOrganization } from '@/lib/api/server/organization-presenters'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2OrganizationErrorPolicy } from '@/lib/api/server/routes/organizations'
import { organizationOperations } from '@/lib/organizations/application/operations'
import { getOrganization } from '@/lib/organizations/application/reads'

export const GET = defineV2JsonRoute({
  contract: v2GetOrganizationContract,
  operation: organizationOperations.read,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrganizationErrorPolicy,
  mapInput: ({ params }) => params,
  useCase: getOrganization,
  present: (organization) => ({ data: presentOrganization(organization) }),
})
