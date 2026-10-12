import { v2SetPrimarySsoProviderContract } from '@/lib/api/contracts/v2/sso'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2SsoErrorPolicy } from '@/lib/api/server/routes/sso'
import { ssoSettingsOperations } from '@/lib/auth/sso/application/operations'
import { setPrimarySsoProvider } from '@/lib/auth/sso/application/set-primary-provider'

export const POST = defineV2JsonRoute({
  contract: v2SetPrimarySsoProviderContract,
  operation: ssoSettingsOperations.setPrimary,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2SsoErrorPolicy,
  parseOptions: { optionalJsonBody: true },
  mapInput: ({ params }) => ({
    providerId: params.providerId,
    assertedOrganizationId: params.organizationId,
  }),
  useCase: setPrimarySsoProvider,
  present: ({ providerId, domain }) => ({ data: { providerId, domain } }),
})
