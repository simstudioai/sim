/** @vitest-environment node */
import { beforeEach, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ enroll: vi.fn(), context: vi.fn(), start: vi.fn() }))
vi.mock('@/lib/credential-groups/self-enrollment', () => ({
  createViewerCredentialGroupEnrollment: m.enroll,
}))
vi.mock('@/lib/credential-groups/enrollments', () => ({
  getCredentialGroupOAuthContextForEnrollment: m.context,
}))
vi.mock('@/lib/credential-groups/oauth', () => ({ startCredentialGroupOAuth: m.start }))

import { startViewerCredentialGroupOAuth } from '@/lib/credential-groups/self-enrollment-oauth'

const input = {
  organizationId: 'org',
  userId: 'person',
  credentialGroupId: 'group',
  optionId: 'slack-option',
  completionId: '550e8400-e29b-41d4-a716-446655440000',
  connectionIntent: { kind: 'reconnect', credentialId: 'owned-account' },
} as const
beforeEach(() => {
  vi.clearAllMocks()
  m.enroll.mockResolvedValue({
    enrollment: { id: 'enrollment', email: 'person@example.test' },
    invitationLink: 'https://sim.test/credential-groups/enroll/token',
  })
  m.context.mockResolvedValue({ credentialOwnerId: 'person' })
  m.start.mockResolvedValue('https://provider.test/oauth')
})
it('binds the OAuth attempt and completion receipt to the current enrollment and explicit intent', async () => {
  expect(await startViewerCredentialGroupOAuth(input)).toEqual({
    invitationLink: 'https://sim.test/credential-groups/enroll/token',
    authorizationUrl: 'https://provider.test/oauth',
  })
  expect(m.context).toHaveBeenCalledWith(
    {
      organizationId: 'org',
      workspaceId: undefined,
      credentialGroupId: 'group',
      enrollmentId: 'enrollment',
      email: 'person@example.test',
      userId: 'person',
    },
    'slack-option'
  )
  expect(m.start).toHaveBeenCalledWith({ credentialOwnerId: 'person' }, 'token', {
    completionRedirect: true,
    returnTo: 'search',
    completionId: input.completionId,
    connectionIntent: input.connectionIntent,
  })
})
it('propagates revoked enrollment and refuses a missing current OAuth context', async () => {
  m.enroll.mockRejectedValueOnce(new Error('Revoked enrollment'))
  await expect(startViewerCredentialGroupOAuth(input)).rejects.toThrow('Revoked enrollment')
  expect(m.start).not.toHaveBeenCalled()
  m.context.mockResolvedValue(null)
  await expect(startViewerCredentialGroupOAuth(input)).rejects.toThrow('no longer available')
  expect(m.start).not.toHaveBeenCalled()
})
