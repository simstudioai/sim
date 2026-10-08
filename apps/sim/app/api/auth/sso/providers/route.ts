import { listSsoProvidersContract } from '@/lib/api/contracts/auth'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalSsoErrorPolicy } from '@/lib/api/server/routes/sso'
import { presentSsoProviderSettings } from '@/lib/api/server/sso-presenters'
import { ssoProviderOperations } from '@/lib/auth/sso/application/operations'
import { listSsoProviders } from '@/lib/auth/sso/application/provider-settings'

export const GET = defineInternalJsonRoute({
  contract: listSsoProvidersContract,
  auth: internalSessionAuth,
  operation: ssoProviderOperations.list,
  rateLimit: internalRateLimits.none({
    reason: 'Preserves the existing session-only SSO settings read policy.',
  }),
  errorPolicy: internalSsoErrorPolicy,
  mapInput: ({ query }) => ({ organizationId: query.organizationId }),
  useCase: listSsoProviders,
  present: ({ providers }) => ({ providers: providers.map(presentSsoProviderSettings) }),
})
