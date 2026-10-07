import { v2VerifyOrganizationDomainContract } from '@/lib/api/contracts/v2/sso'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2SsoErrorPolicy } from '@/lib/api/server/routes/sso'
import { toDomainResponse } from '@/lib/auth/sso/domain-verification'
import { verifyOrganizationDomain } from '@/lib/organizations/application/domain-settings'
import { organizationSecurityOperations } from '@/lib/organizations/application/operations'

export const POST = defineV2JsonRoute({
  contract: v2VerifyOrganizationDomainContract,
  operation: organizationSecurityOperations.verifyDomain,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2SsoErrorPolicy,
  mapInput: ({ params }) => params,
  useCase: verifyOrganizationDomain,
  present: ({ domain }) => ({ data: toDomainResponse(domain) }),
})
