import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/credential-groups/organization-setup`. Bare `vi.fn()`
 * (resolves `undefined`, i.e. setup is ready and nothing throws).
 *
 * @example
 * ```ts
 * import { credentialGroupsOrganizationSetupMockFns } from '@sim/testing/mocks/credential-groups-organization-setup.mock'
 *
 * credentialGroupsOrganizationSetupMockFns.mockRequireOrganizationAccountsSetup.mockRejectedValue(error)
 * ```
 */
export const credentialGroupsOrganizationSetupMockFns = {
  mockRequireOrganizationAccountsSetup: vi.fn(),
}

/**
 * Static mock module for `@/lib/credential-groups/organization-setup`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/credential-groups/organization-setup', () => credentialGroupsOrganizationSetupMock)
 * ```
 */
export const credentialGroupsOrganizationSetupMock = {
  requireOrganizationAccountsSetup:
    credentialGroupsOrganizationSetupMockFns.mockRequireOrganizationAccountsSetup,
}
