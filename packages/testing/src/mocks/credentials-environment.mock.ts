import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/credentials/environment`. Every function is a bare
 * `vi.fn()`.
 *
 * @example
 * ```ts
 * import { credentialsEnvironmentMockFns } from '@sim/testing/mocks/credentials-environment.mock'
 *
 * expect(credentialsEnvironmentMockFns.mockSyncWorkspaceEnvCredentials).toHaveBeenCalled()
 * ```
 */
export const credentialsEnvironmentMockFns = {
  mockGetCredentialCreationWorkspaceContext: vi.fn(),
  mockGetPersonalEnvKeyRawAccess: vi.fn(),
  mockHasWorkspaceEnvValue: vi.fn(),
  mockGetWorkspaceEnvKeyAdminAccess: vi.fn(),
  mockGetUserWorkspaceIds: vi.fn(),
  mockSyncWorkspaceEnvCredentials: vi.fn(),
  mockCreateWorkspaceEnvCredentials: vi.fn(),
  mockDeleteWorkspaceEnvCredentials: vi.fn(),
  mockUpsertPersonalEnvCredentialForUser: vi.fn(),
  mockGetPersonalEnvCredentialMetadata: vi.fn(),
  mockDeletePersonalEnvCredentialForUser: vi.fn(),
  mockSyncPersonalEnvCredentialsForUser: vi.fn(),
  mockGetAccessibleEnvCredentials: vi.fn(),
  mockGetEnrolledManagedOAuthCredentials: vi.fn(),
  mockGetAccessibleOAuthCredentials: vi.fn(),
}

const fns = credentialsEnvironmentMockFns

/**
 * Static mock module for `@/lib/credentials/environment`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/credentials/environment', () => credentialsEnvironmentMock)
 * ```
 */
export const credentialsEnvironmentMock = {
  getCredentialCreationWorkspaceContext: fns.mockGetCredentialCreationWorkspaceContext,
  getPersonalEnvKeyRawAccess: fns.mockGetPersonalEnvKeyRawAccess,
  hasWorkspaceEnvValue: fns.mockHasWorkspaceEnvValue,
  getWorkspaceEnvKeyAdminAccess: fns.mockGetWorkspaceEnvKeyAdminAccess,
  getUserWorkspaceIds: fns.mockGetUserWorkspaceIds,
  syncWorkspaceEnvCredentials: fns.mockSyncWorkspaceEnvCredentials,
  createWorkspaceEnvCredentials: fns.mockCreateWorkspaceEnvCredentials,
  deleteWorkspaceEnvCredentials: fns.mockDeleteWorkspaceEnvCredentials,
  upsertPersonalEnvCredentialForUser: fns.mockUpsertPersonalEnvCredentialForUser,
  getPersonalEnvCredentialMetadata: fns.mockGetPersonalEnvCredentialMetadata,
  deletePersonalEnvCredentialForUser: fns.mockDeletePersonalEnvCredentialForUser,
  syncPersonalEnvCredentialsForUser: fns.mockSyncPersonalEnvCredentialsForUser,
  getAccessibleEnvCredentials: fns.mockGetAccessibleEnvCredentials,
  getEnrolledManagedOAuthCredentials: fns.mockGetEnrolledManagedOAuthCredentials,
  getAccessibleOAuthCredentials: fns.mockGetAccessibleOAuthCredentials,
}
