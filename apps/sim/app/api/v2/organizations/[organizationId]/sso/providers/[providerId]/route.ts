import { v2DeleteSsoProviderContract, v2GetSsoProviderContract } from '@/lib/api/contracts/v2/sso'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2SsoErrorPolicy } from '@/lib/api/server/routes/sso'
import { presentSsoProvider } from '@/lib/api/server/sso-presenters'
import { ssoProviderOperations } from '@/lib/auth/sso/application/operations'
import { deleteSsoProvider, getSsoProvider } from '@/lib/auth/sso/application/provider-settings'

export const GET = defineV2JsonRoute({
  contract: v2GetSsoProviderContract,
  operation: ssoProviderOperations.list,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2SsoErrorPolicy,
  mapInput: ({ params }) => params,
  useCase: getSsoProvider,
  present: (provider) => ({ data: presentSsoProvider(provider) }),
})
export const DELETE = defineV2JsonRoute({
  contract: v2DeleteSsoProviderContract,
  operation: ssoProviderOperations.delete,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2SsoErrorPolicy,
  mapInput: ({ params }) => params,
  useCase: deleteSsoProvider,
  present: ({ providerId }) => ({ data: { providerId, deleted: true as const } }),
})
