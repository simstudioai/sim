import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/credential-groups/self-enrollment`. Bare `vi.fn()`.
 *
 * @example
 * ```ts
 * import { credentialGroupsSelfEnrollmentMockFns } from '@sim/testing/mocks/credential-groups-self-enrollment.mock'
 *
 * credentialGroupsSelfEnrollmentMockFns.mockCreateViewerCredentialGroupEnrollment.mockResolvedValue({
 *   invitationLink: 'https://example.test/enroll', enrollment: { id: 'enrollment-1', email: 'a@b.test' },
 * })
 * ```
 */
export const credentialGroupsSelfEnrollmentMockFns = {
  mockCreateViewerCredentialGroupEnrollment: vi.fn(),
}

/**
 * Static mock module for `@/lib/credential-groups/self-enrollment`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/credential-groups/self-enrollment', () => credentialGroupsSelfEnrollmentMock)
 * ```
 */
export const credentialGroupsSelfEnrollmentMock = {
  createViewerCredentialGroupEnrollment:
    credentialGroupsSelfEnrollmentMockFns.mockCreateViewerCredentialGroupEnrollment,
}
