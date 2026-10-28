import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/credential-groups/provider-registry`. Both are bare
 * `vi.fn()`: tests supply the adapter (`{ getPolicy, hasRequiredScopes, … }`) they exercise.
 *
 * @example
 * ```ts
 * import { credentialGroupsProvidersMockFns } from '@sim/testing/mocks/credential-groups-providers.mock'
 *
 * credentialGroupsProvidersMockFns.mockGetCredentialGroupProviderAdapter.mockReturnValue({ getPolicy })
 * ```
 */
export const credentialGroupsProvidersMockFns = {
  mockGetCredentialGroupProviderAdapter: vi.fn(),
  mockGetCredentialGroupProviderAdapterByProviderId: vi.fn(),
}

/**
 * Static mock module for `@/lib/credential-groups/provider-registry`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/credential-groups/provider-registry', () => credentialGroupsProvidersMock)
 * ```
 */
export const credentialGroupsProvidersMock = {
  getCredentialGroupProviderAdapter:
    credentialGroupsProvidersMockFns.mockGetCredentialGroupProviderAdapter,
  getCredentialGroupProviderAdapterByProviderId:
    credentialGroupsProvidersMockFns.mockGetCredentialGroupProviderAdapterByProviderId,
}
