import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/credential-groups/scoped-availability`.
 *
 * Default: `mockIsScopedCredentialGroupsAvailable` resolves `true` (credential groups available).
 *
 * @example
 * ```ts
 * import { credentialGroupsAvailabilityMockFns } from '@sim/testing/mocks/credential-groups-availability.mock'
 *
 * credentialGroupsAvailabilityMockFns.mockIsScopedCredentialGroupsAvailable.mockResolvedValue(false)
 * ```
 */
export const credentialGroupsAvailabilityMockFns = {
  mockIsScopedCredentialGroupsAvailable: vi.fn(async (_scope: unknown): Promise<boolean> => true),
}

/**
 * Static mock module for `@/lib/credential-groups/scoped-availability`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/credential-groups/scoped-availability', () => credentialGroupsAvailabilityMock)
 * ```
 */
export const credentialGroupsAvailabilityMock = {
  isScopedCredentialGroupsAvailable:
    credentialGroupsAvailabilityMockFns.mockIsScopedCredentialGroupsAvailable,
}
