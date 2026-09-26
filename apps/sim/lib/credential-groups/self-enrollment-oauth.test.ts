import {
  credentialGroupsEnrollmentsMock,
  credentialGroupsEnrollmentsMockFns,
} from '@sim/testing/mocks/credential-groups-enrollments.mock'
import {
  credentialGroupsSelfEnrollmentMock,
  credentialGroupsSelfEnrollmentMockFns,
} from '@sim/testing/mocks/credential-groups-self-enrollment.mock'
import { beforeEach, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({ start: vi.fn() }))
vi.mock('@/lib/credential-groups/self-enrollment', () => credentialGroupsSelfEnrollmentMock)
vi.mock('@/lib/credential-groups/enrollments', () => credentialGroupsEnrollmentsMock)
vi.mock('@/lib/credential-groups/oauth', () => ({ startCredentialGroupOAuth: hoisted.start }))

import { startViewerCredentialGroupOAuth } from '@/lib/credential-groups/self-enrollment-oauth'

const m = {
  ...hoisted,
  enroll: credentialGroupsSelfEnrollmentMockFns.mockCreateViewerCredentialGroupEnrollment,
  context: credentialGroupsEnrollmentsMockFns.mockGetCredentialGroupOAuthContextForEnrollment,
}

const input = {
  organizationId: 'org',
  userId: 'person',
  credentialGroupId: 'group',
  optionId: 'slack-option',
  completionId: '550e8400-e29b-41d4-a716-446655440000',
  connectionIntent: { kind: 'reconnect', credentialId: 'owned-account' },
} as const
beforeEach(() => {
  m.enroll.mockResolvedValue({
    enrollment: { id: 'enrollment', email: 'person@example.test' },
    invitationLink: 'https://sim.test/credential-groups/enroll/token',
  })
  m.context.mockResolvedValue({ credentialOwnerId: 'person' })
  m.start.mockResolvedValue('https://provider.test/oauth')
})
it('propagates revoked enrollment and refuses a missing current OAuth context', async () => {
  m.enroll.mockRejectedValueOnce(new Error('Revoked enrollment'))
  await expect(startViewerCredentialGroupOAuth(input)).rejects.toThrow('Revoked enrollment')
  expect(m.start).not.toHaveBeenCalled()
  m.context.mockResolvedValue(null)
  await expect(startViewerCredentialGroupOAuth(input)).rejects.toThrow('no longer available')
  expect(m.start).not.toHaveBeenCalled()
})
