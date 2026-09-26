import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import {
  credentialGroupsEnrollmentsMock,
  credentialGroupsEnrollmentsMockFns,
} from '@sim/testing/mocks/credential-groups-enrollments.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  requireAvailable: vi.fn(),
  resolveGroup: vi.fn(),
}))

vi.mock('@/lib/credential-groups/application/context', () => ({
  requireCredentialGroupSettingsAvailable: hoisted.requireAvailable,
  resolveCredentialGroupSettingsContext: hoisted.resolveGroup,
}))

vi.mock('@/lib/credential-groups/enrollments', () => credentialGroupsEnrollmentsMock)

vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)

import { inviteCredentialGroupEnrollmentsSettings } from '@/lib/credential-groups/application/manage-enrollments'

const mocks = {
  ...hoisted,
  invite: credentialGroupsEnrollmentsMockFns.mockInviteCredentialGroupEnrollments,
  loadInviter: credentialGroupsEnrollmentsMockFns.mockLoadCredentialGroupInviterIdentity,
}

const resolvePermission = workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission

const context = {
  workspaceId: 'workspace-1',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-1',
  credentialGroupId: 'group-1',
  name: 'Support',
  status: 'active' as const,
  options: [],
}
const principal = createSessionPrincipal({ userId: 'admin-1' })
const input = {
  assertedWorkspaceId: 'workspace-1',
  credentialGroupId: 'group-1',
  emails: [' Person@Example.com ', 'person@example.com'],
}

describe('Credential Group enrollment Settings operations', () => {
  beforeEach(() => {
    mocks.resolveGroup.mockResolvedValue(context)
    resolvePermission.mockResolvedValue('admin')
    mocks.requireAvailable.mockResolvedValue(undefined)
    mocks.loadInviter.mockResolvedValue({ name: 'Admin', email: 'admin@example.com' })
    mocks.invite.mockResolvedValue({ results: [], sentCount: 0, failedCount: 0 })
  })

  it('requires current workspace-admin permission before delivery', async () => {
    resolvePermission.mockResolvedValue('write')

    await expect(
      inviteCredentialGroupEnrollmentsSettings.execute({ principal, input })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.invite).not.toHaveBeenCalled()
  })

  it('derives the inviter and normalizes recipients inside the application command', async () => {
    await inviteCredentialGroupEnrollmentsSettings.execute({ principal, input })

    expect(mocks.loadInviter).toHaveBeenCalledWith('admin-1')
    expect(mocks.invite).toHaveBeenCalledWith('workspace-1', 'group-1', 'admin-1', 'Admin', {
      emails: ['person@example.com'],
    })
  })

  it('rejects an unbounded batch even outside the HTTP adapter', async () => {
    await expect(
      inviteCredentialGroupEnrollmentsSettings.execute({
        principal,
        input: {
          ...input,
          emails: Array.from({ length: 101 }, (_, index) => `person-${index}@example.com`),
        },
      })
    ).rejects.toMatchObject({ code: 'validation' })
    expect(mocks.invite).not.toHaveBeenCalled()
  })
})
