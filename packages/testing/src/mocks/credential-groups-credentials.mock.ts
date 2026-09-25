import { vi } from 'vitest'

/**
 * Stand-in for `CredentialGroupCredentialCursorNotFoundError` from
 * `@/lib/credential-groups/credentials`: same `name` and message.
 */
export class MockCredentialGroupCredentialCursorNotFoundError extends Error {
  constructor() {
    super('Credential group credential cursor not found')
    this.name = 'CredentialGroupCredentialCursorNotFoundError'
  }
}

const LIVE_ENROLLMENT_STATUSES = ['in_progress', 'completed'] as const

interface MockManagedCredentialGroupBindingStatus {
  managedOauthStatus: string
  enrollmentStatus: string
  groupStatus: string
  optionStatus: string | null
}

/**
 * Controllable mock functions for `@/lib/credential-groups/credentials`.
 *
 * Every loader is a bare `vi.fn()` except `mockIsManagedCredentialGroupBindingLive`, which ports
 * the real predicate (credential, enrollment, group and option all live).
 *
 * @example
 * ```ts
 * import { credentialGroupsCredentialsMockFns } from '@sim/testing/mocks/credential-groups-credentials.mock'
 *
 * credentialGroupsCredentialsMockFns.mockLoadScopedAccountsCredentialListContext.mockResolvedValue(group)
 * ```
 */
export const credentialGroupsCredentialsMockFns = {
  mockIsManagedCredentialGroupBindingLive: vi.fn(
    (binding: MockManagedCredentialGroupBindingStatus): boolean =>
      binding.managedOauthStatus === 'active' &&
      (LIVE_ENROLLMENT_STATUSES as readonly string[]).includes(binding.enrollmentStatus) &&
      binding.groupStatus === 'active' &&
      binding.optionStatus === 'active'
  ),
  mockLoadCredentialGroupEnrollmentAccess: vi.fn(),
  mockLoadCredentialGroupEnrollmentAccessForSubject: vi.fn(),
  mockLoadCredentialGroupCredentialListContext: vi.fn(),
  mockLoadWorkspaceAccountsCredentialListContext: vi.fn(),
  mockLoadManagedCredentialGroupBinding: vi.fn(),
  mockListCredentialGroupCredentialReferences: vi.fn(),
  mockListCredentialGroupOptionCredentialReferences: vi.fn(),
  mockLoadScopedAccountsCredentialListContext: vi.fn(),
}

/**
 * Static mock module for `@/lib/credential-groups/credentials`. Constants carry the real values.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/credential-groups/credentials', () => credentialGroupsCredentialsMock)
 * ```
 */
export const credentialGroupsCredentialsMock = {
  MAX_CREDENTIAL_GROUP_CREDENTIAL_PAGE_SIZE: 100,
  LIVE_ENROLLMENT_STATUSES,
  CredentialGroupCredentialCursorNotFoundError: MockCredentialGroupCredentialCursorNotFoundError,
  isManagedCredentialGroupBindingLive:
    credentialGroupsCredentialsMockFns.mockIsManagedCredentialGroupBindingLive,
  loadCredentialGroupEnrollmentAccess:
    credentialGroupsCredentialsMockFns.mockLoadCredentialGroupEnrollmentAccess,
  loadCredentialGroupEnrollmentAccessForSubject:
    credentialGroupsCredentialsMockFns.mockLoadCredentialGroupEnrollmentAccessForSubject,
  loadCredentialGroupCredentialListContext:
    credentialGroupsCredentialsMockFns.mockLoadCredentialGroupCredentialListContext,
  loadWorkspaceAccountsCredentialListContext:
    credentialGroupsCredentialsMockFns.mockLoadWorkspaceAccountsCredentialListContext,
  loadManagedCredentialGroupBinding:
    credentialGroupsCredentialsMockFns.mockLoadManagedCredentialGroupBinding,
  listCredentialGroupCredentialReferences:
    credentialGroupsCredentialsMockFns.mockListCredentialGroupCredentialReferences,
  listCredentialGroupOptionCredentialReferences:
    credentialGroupsCredentialsMockFns.mockListCredentialGroupOptionCredentialReferences,
  loadScopedAccountsCredentialListContext:
    credentialGroupsCredentialsMockFns.mockLoadScopedAccountsCredentialListContext,
}
