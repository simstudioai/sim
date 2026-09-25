import { vi } from 'vitest'

/**
 * Mirrors `OrganizationMembershipNotFoundError` from
 * `@/lib/core/application/organization-authorization`: same `name` (`OrchestrationError`), `code`
 * (`not_found`) and message. It extends plain `Error`, not the real `OrchestrationError`, so
 * `instanceof OrchestrationError` in unmocked code is false.
 */
export class MockOrganizationMembershipNotFoundError extends Error {
  readonly code = 'not_found' as const

  constructor() {
    super('Organization not found')
    this.name = 'OrchestrationError'
  }
}

/**
 * Controllable mock functions for `@/lib/core/application/organization-authorization`.
 * Both are bare `vi.fn()`s (resolve `undefined`); set the membership context per test.
 *
 * @example
 * ```ts
 * import { organizationAuthorizationMockFns } from '@sim/testing/mocks/organization-authorization.mock'
 *
 * organizationAuthorizationMockFns.mockAuthorizeOrganizationOperation.mockResolvedValue({
 *   organizationId: 'org-1', userId: 'user-1', role: 'admin',
 * })
 * ```
 */
export const organizationAuthorizationMockFns = {
  mockRequireOrganizationMembership: vi.fn(),
  mockAuthorizeOrganizationOperation: vi.fn(),
}

/**
 * Static mock module for `@/lib/core/application/organization-authorization`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/core/application/organization-authorization', () => organizationAuthorizationMock)
 * ```
 */
export const organizationAuthorizationMock = {
  OrganizationMembershipNotFoundError: MockOrganizationMembershipNotFoundError,
  requireOrganizationMembership: organizationAuthorizationMockFns.mockRequireOrganizationMembership,
  authorizeOrganizationOperation:
    organizationAuthorizationMockFns.mockAuthorizeOrganizationOperation,
}
