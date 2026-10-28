import { vi } from 'vitest'

interface MockServiceProviderIdentity {
  providerId: string
  serviceAccountProviderId?: string
  additionalProviderIds?: readonly string[]
}

const IGNORED_SCOPES = new Set(['offline_access', 'refresh_token', 'offline.access'])

function isScopeSatisfiedBy(required: string, granted: ReadonlySet<string>): boolean {
  const readonlySuffix = '.readonly'
  if (!required.endsWith(readonlySuffix)) return false
  return granted.has(required.slice(0, -readonlySuffix.length))
}

/**
 * Controllable mock functions for `@/lib/oauth/utils`.
 *
 * Helpers that need no provider registry port the real logic:
 * `mockCredentialProviderMatchesService`, `mockCanonicalizeServiceProviderId`,
 * `mockGetMissingRequiredScopes` and `mockIsScopeSatisfiedBy`.
 * Registry lookups answer as for an unknown provider/service: `mockGetScopeDescription` returns the
 * raw scope, `mockGetCanonicalScopesForProvider` and `mockGetScopesForService` return `[]`, and
 * `mockProviderIdsForService` returns `[providerId]`. Every other lookup
 * (`mockGetAllOAuthServices`, `mockGetServiceByProviderAndId`, `mockGetProviderIdFromServiceId`,
 * `mockGetServiceConfigByServiceId`, `mockGetServiceConfigByProviderId`,
 * `mockUsesCredentialConfiguredOAuthClient`, `mockGetServiceAccountProviderForProviderId`,
 * `mockGetPerRequestOAuthLinkScopes`, `mockParseProvider`) is a bare `vi.fn()`.
 *
 * @example
 * ```ts
 * import { oauthUtilsMockFns } from '@sim/testing/mocks/oauth-utils.mock'
 *
 * oauthUtilsMockFns.mockGetCanonicalScopesForProvider.mockReturnValue(['openid'])
 * ```
 */
export const oauthUtilsMockFns = {
  mockGetScopeDescription: vi.fn((scope: string, _providerId?: string): string => scope),
  mockGetAllOAuthServices: vi.fn(),
  mockGetServiceByProviderAndId: vi.fn(),
  mockGetProviderIdFromServiceId: vi.fn(),
  mockGetServiceConfigByServiceId: vi.fn(),
  mockGetServiceConfigByProviderId: vi.fn(),
  mockUsesCredentialConfiguredOAuthClient: vi.fn(),
  mockGetServiceAccountProviderForProviderId: vi.fn(),
  mockCredentialProviderMatchesService: vi.fn(
    (credentialProviderId: string, service: MockServiceProviderIdentity): boolean =>
      service.providerId === credentialProviderId ||
      service.serviceAccountProviderId === credentialProviderId ||
      (service.additionalProviderIds?.includes(credentialProviderId) ?? false)
  ),
  mockProviderIdsForService: vi.fn((providerId: string): string[] => [providerId]),
  mockCanonicalizeServiceProviderId: vi.fn(
    (credentialProviderId: string, service: MockServiceProviderIdentity | undefined): string =>
      service?.additionalProviderIds?.includes(credentialProviderId)
        ? service.providerId
        : credentialProviderId
  ),
  mockGetCanonicalScopesForProvider: vi.fn((_providerId: string): string[] => []),
  mockGetPerRequestOAuthLinkScopes: vi.fn(),
  mockGetScopesForService: vi.fn((_serviceId: string): string[] => []),
  mockGetMissingRequiredScopes: vi.fn(
    (
      credential: { scopes?: string[]; type?: string } | undefined,
      requiredScopes: string[] = []
    ): string[] => {
      if (!credential) return requiredScopes.filter((s) => !IGNORED_SCOPES.has(s))
      if (credential.type === 'service_account') return []
      const granted = new Set(credential.scopes || [])
      return requiredScopes.filter(
        (s) => !IGNORED_SCOPES.has(s) && !granted.has(s) && !isScopeSatisfiedBy(s, granted)
      )
    }
  ),
  mockIsScopeSatisfiedBy: vi.fn(isScopeSatisfiedBy),
  mockParseProvider: vi.fn(),
}

const fns = oauthUtilsMockFns

/**
 * Static mock module for `@/lib/oauth/utils`. `SCOPE_DESCRIPTIONS` is an empty map (the real
 * ~500-entry label table is not copied), consistent with `getScopeDescription` returning the raw
 * scope.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/oauth/utils', () => oauthUtilsMock)
 * ```
 */
export const oauthUtilsMock = {
  SCOPE_DESCRIPTIONS: {} as Record<string, string>,
  getScopeDescription: fns.mockGetScopeDescription,
  getAllOAuthServices: fns.mockGetAllOAuthServices,
  getServiceByProviderAndId: fns.mockGetServiceByProviderAndId,
  getProviderIdFromServiceId: fns.mockGetProviderIdFromServiceId,
  getServiceConfigByServiceId: fns.mockGetServiceConfigByServiceId,
  getServiceConfigByProviderId: fns.mockGetServiceConfigByProviderId,
  usesCredentialConfiguredOAuthClient: fns.mockUsesCredentialConfiguredOAuthClient,
  getServiceAccountProviderForProviderId: fns.mockGetServiceAccountProviderForProviderId,
  credentialProviderMatchesService: fns.mockCredentialProviderMatchesService,
  providerIdsForService: fns.mockProviderIdsForService,
  canonicalizeServiceProviderId: fns.mockCanonicalizeServiceProviderId,
  getCanonicalScopesForProvider: fns.mockGetCanonicalScopesForProvider,
  getPerRequestOAuthLinkScopes: fns.mockGetPerRequestOAuthLinkScopes,
  getScopesForService: fns.mockGetScopesForService,
  getMissingRequiredScopes: fns.mockGetMissingRequiredScopes,
  isScopeSatisfiedBy: fns.mockIsScopeSatisfiedBy,
  parseProvider: fns.mockParseProvider,
}
