import { v2RemoveOrganizationDomainContract } from '@/lib/api/contracts/v2/sso'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2SsoErrorPolicy } from '@/lib/api/server/routes/sso'
import { removeOrganizationDomain } from '@/lib/organizations/application/domain-settings'
import { organizationSecurityOperations } from '@/lib/organizations/application/operations'

export const DELETE = defineV2JsonRoute({
  contract: v2RemoveOrganizationDomainContract,
  operation: organizationSecurityOperations.removeDomain,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2SsoErrorPolicy,
  mapInput: ({ params }) => params,
  useCase: removeOrganizationDomain,
  present: (_result, { params }) => ({ data: { id: params.domainId, deleted: true as const } }),
})
