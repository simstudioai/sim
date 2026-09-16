/** @vitest-environment node */
import { sha256Hex } from '@sim/security/hash'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ authenticate: vi.fn(), getSession: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/credential-groups/enrollments', () => ({
  authenticatePublicCredentialGroupEnrollment: mocks.authenticate,
}))

import {
  authenticateCredentialGroupEnrollment,
  credentialGroupOAuthAttemptPrincipal,
} from '@/lib/credential-groups/application/enrollment-auth'
import type { CredentialGroupOAuthAttempt } from '@/lib/credential-groups/oauth-state'

describe('consumed OAuth attempt identity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSession.mockResolvedValue({ user: { id: 'user-1', emailVerified: true } })
  })
  it('retains the old invitation identity without reauthenticating a rotated bearer', async () => {
    const attempt = {
      userId: 'user-1',
      workspaceId: 'workspace',
      credentialGroupId: 'group',
      enrollmentId: 'enrollment',
      email: 'person@example.com',
      invitationToken: 'old-invitation',
    } as CredentialGroupOAuthAttempt
    const principal = await credentialGroupOAuthAttemptPrincipal(attempt)
    expect(principal).toEqual({
      kind: 'credential_group_enrollment',
      userId: 'user-1',
      workspaceId: 'workspace',
      credentialGroupId: 'group',
      enrollmentId: 'enrollment',
      email: 'person@example.com',
      invitationTokenHash: sha256Hex('old-invitation'),
    })
    expect(Object.isFrozen(principal)).toBe(true)
    expect(mocks.authenticate).not.toHaveBeenCalled()
    mocks.authenticate.mockResolvedValue(null)
    expect(await authenticateCredentialGroupEnrollment('old-invitation')).toBeNull()
    expect(mocks.authenticate).toHaveBeenCalledWith('old-invitation')
  })
  it('rejects completion from a different signed-in user', async () => {
    await expect(
      credentialGroupOAuthAttemptPrincipal({
        userId: 'other-user',
        organizationId: 'org-1',
        credentialGroupId: 'group',
        enrollmentId: 'enrollment',
        email: 'person@example.com',
        invitationToken: 'token',
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
  })
  it('requires a verified signed-in user before reading an invitation', async () => {
    mocks.getSession.mockResolvedValue(null)
    expect(await authenticateCredentialGroupEnrollment('token')).toBeNull()
    expect(mocks.authenticate).not.toHaveBeenCalled()
  })
})
