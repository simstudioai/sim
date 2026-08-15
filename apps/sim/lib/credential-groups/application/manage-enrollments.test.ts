/**
 * @vitest-environment node
 */
import type { SessionPrincipal } from '@sim/auth/principal'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invite: vi.fn(),
  loadInviter: vi.fn(),
  requireAvailable: vi.fn(),
  resolveGroup: vi.fn(),
  resolvePermission: vi.fn(),
}))

vi.mock('@/lib/credential-groups/application/context', () => ({
  requireCredentialGroupSettingsAvailable: mocks.requireAvailable,
  resolveCredentialGroupSettingsContext: mocks.resolveGroup,
}))

vi.mock('@/lib/credential-groups/enrollments', () => ({
  CredentialGroupEnrollmentError: class CredentialGroupEnrollmentError extends Error {
    constructor(
      message: string,
      readonly status: 400 | 404 | 409 | 502
    ) {
      super(message)
    }
  },
  deleteCredentialGroupEnrollment: vi.fn(),
  inviteCredentialGroupEnrollments: mocks.invite,
  loadCredentialGroupInviterIdentity: mocks.loadInviter,
  resendCredentialGroupEnrollment: vi.fn(),
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (permission: string | null, required: string) =>
    permission === 'admin' || permission === required,
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))

import { inviteCredentialGroupEnrollmentsSettings } from '@/lib/credential-groups/application/manage-enrollments'

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
const principal: SessionPrincipal = {
  kind: 'session',
  userId: 'admin-1',
  sessionId: 'session-1',
}
const input = {
  assertedWorkspaceId: 'workspace-1',
  credentialGroupId: 'group-1',
  emails: [' Person@Example.com ', 'person@example.com'],
}

describe('Credential Group enrollment Settings operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveGroup.mockResolvedValue(context)
    mocks.resolvePermission.mockResolvedValue('admin')
    mocks.requireAvailable.mockResolvedValue(undefined)
    mocks.loadInviter.mockResolvedValue({ name: 'Admin', email: 'admin@example.com' })
    mocks.invite.mockResolvedValue({ results: [], sentCount: 0, failedCount: 0 })
  })

  it('requires current workspace-admin permission before delivery', async () => {
    mocks.resolvePermission.mockResolvedValue('write')

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
