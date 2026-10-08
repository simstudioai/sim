import { v2ListSsoProvidersContract, v2SaveSsoProviderContract } from '@/lib/api/contracts/v2/sso'
import { cursorRoute, cursorScopeKey } from '@/lib/api/cursor-binding'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2SsoErrorPolicy } from '@/lib/api/server/routes/sso'
import { presentSsoProvider } from '@/lib/api/server/sso-presenters'
import { ssoProviderOperations } from '@/lib/auth/sso/application/operations'
import { saveSsoProvider } from '@/lib/auth/sso/application/provider-registration'
import { listSsoProviders } from '@/lib/auth/sso/application/provider-settings'
import { readSortedCursor, writeSortedCursor } from '@/app/api/v2/lib/response'

export const GET = defineV2JsonRoute({
  contract: v2ListSsoProvidersContract,
  operation: ssoProviderOperations.list,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2SsoErrorPolicy,
  mapInput: ({ params, query }) => ({
    ...params,
    ...query,
    cursorKeys: readSortedCursor(
      query.cursor,
      query.sortBy,
      query.sortOrder,
      cursorScopeKey(cursorRoute(v2ListSsoProvidersContract, params), {})
    ),
  }),
  useCase: listSsoProviders,
  present: ({ providers, nextCursorKeys }, { params, query }) => ({
    data: providers.map(presentSsoProvider),
    nextCursor: writeSortedCursor(
      nextCursorKeys,
      query.sortBy,
      query.sortOrder,
      cursorScopeKey(cursorRoute(v2ListSsoProvidersContract, params), {})
    ),
  }),
})
export const POST = defineV2JsonRoute({
  contract: v2SaveSsoProviderContract,
  operation: ssoProviderOperations.save,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2SsoErrorPolicy,
  parseOptions: { maxBodyBytes: 262144 },
  mapInput: ({ params, body }) => ({ ...params, ...body }),
  useCase: saveSsoProvider,
  present: ({ providerId, providerType, created }) => ({
    data: { providerId, providerType, created },
  }),
  statusForResult: ({ created }) => (created ? 201 : 200),
})
