import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/credential-groups/service`. Every function is a bare
 * `vi.fn()`.
 *
 * @example
 * ```ts
 * import { credentialGroupsServiceMockFns } from '@sim/testing/mocks/credential-groups-service.mock'
 *
 * credentialGroupsServiceMockFns.mockGetOrganizationAccountsGroup.mockResolvedValue(group)
 * ```
 */
export const credentialGroupsServiceMockFns = {
  mockGetWorkspaceAccountsGroup: vi.fn(),
  mockGetCredentialGroup: vi.fn(),
  mockEnsureWorkspaceAccountsGroup: vi.fn(),
  mockAddOrganizationAccountProvider: vi.fn(),
  mockUpdateCredentialGroup: vi.fn(),
  mockGetOrganizationAccountsGroup: vi.fn(),
}

/**
 * Static mock module for `@/lib/credential-groups/service`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/credential-groups/service', () => credentialGroupsServiceMock)
 * ```
 */
export const credentialGroupsServiceMock = {
  getWorkspaceAccountsGroup: credentialGroupsServiceMockFns.mockGetWorkspaceAccountsGroup,
  getCredentialGroup: credentialGroupsServiceMockFns.mockGetCredentialGroup,
  ensureWorkspaceAccountsGroup: credentialGroupsServiceMockFns.mockEnsureWorkspaceAccountsGroup,
  addOrganizationAccountProvider: credentialGroupsServiceMockFns.mockAddOrganizationAccountProvider,
  updateCredentialGroup: credentialGroupsServiceMockFns.mockUpdateCredentialGroup,
  getOrganizationAccountsGroup: credentialGroupsServiceMockFns.mockGetOrganizationAccountsGroup,
}
