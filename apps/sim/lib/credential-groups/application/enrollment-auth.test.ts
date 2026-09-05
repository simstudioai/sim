/** @vitest-environment node */
import { sha256Hex } from '@sim/security/hash'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ authenticate: vi.fn() }))
vi.mock('@/lib/credential-groups/enrollments', () => ({
  authenticatePublicCredentialGroupEnrollment: mocks.authenticate,
}))

import {
  authenticateCredentialGroupEnrollment,
  credentialGroupOAuthAttemptPrincipal,
} from '@/lib/credential-groups/application/enrollment-auth'
import type { CredentialGroupOAuthAttempt } from '@/lib/credential-groups/oauth-state'

describe('consumed OAuth attempt identity', () => {
  it('retains the old invitation identity without reauthenticating a rotated bearer', async () => {
    const attempt = {
      workspaceId: 'workspace',
      credentialGroupId: 'group',
      enrollmentId: 'enrollment',
      email: 'person@example.com',
      invitationToken: 'old-invitation',
    } as CredentialGroupOAuthAttempt
    const principal = credentialGroupOAuthAttemptPrincipal(attempt)
    expect(principal).toEqual({
      kind: 'credential_group_enrollment',
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
})
