import { v2GetSsoPolicyContract, v2UpdateSsoPolicyContract } from '@/lib/api/contracts/v2/sso'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2SsoErrorPolicy } from '@/lib/api/server/routes/sso'
import { ssoSettingsOperations } from '@/lib/auth/sso/application/operations'
import { readSsoRequirement, setSsoRequirement } from '@/lib/auth/sso/application/sso-requirement'

export const GET = defineV2JsonRoute({
  contract: v2GetSsoPolicyContract,
  operation: ssoSettingsOperations.readRequirement,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2SsoErrorPolicy,
  mapInput: ({ params }) => params,
  useCase: readSsoRequirement,
  present: (data) => ({ data }),
})
export const PATCH = defineV2JsonRoute({
  contract: v2UpdateSsoPolicyContract,
  operation: ssoSettingsOperations.setRequirement,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2SsoErrorPolicy,
  mapInput: ({ params, body }) => ({ ...params, ...body }),
  useCase: setSsoRequirement,
  present: (data) => ({ data }),
})
