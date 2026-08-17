/**
 * @vitest-environment node
 */
import type { CredentialGroupEnrollmentPrincipal, SessionPrincipal } from '@sim/auth/principal'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  get: vi.fn(),
  list: vi.fn(),
  listEnrollments: vi.fn(),
  requireAvailable: vi.fn(),
  resolveGroup: vi.fn(),
  resolvePermission: vi.fn(),
  resolveWorkspace: vi.fn(),
}))

vi.mock('@/lib/credential-groups/application/context', () => ({
  requireCredentialGroupSettingsAvailable: mocks.requireAvailable,
  resolveCredentialGroupSettingsContext: mocks.resolveGroup,
  resolveCredentialGroupWorkspaceContext: mocks.resolveWorkspace,
}))

vi.mock('@/lib/credential-groups/service', () => ({
  createCredentialGroup: mocks.create,
  deleteCredentialGroup: vi.fn(),
  getCredentialGroup: mocks.get,
  listCredentialGroups: mocks.list,
  updateCredentialGroup: vi.fn(),
}))

vi.mock('@/lib/credential-groups/enrollments', () => ({
  CredentialGroupEnrollmentError: class CredentialGroupEnrollmentError extends Error {
    constructor(
      message: string,
      readonly status: number
    ) {
      super(message)
    }
  },
  listCredentialGroupEnrollments: mocks.listEnrollments,
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (permission: string | null, required: string) =>
    permission === 'admin' || permission === required,
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))

import {
  createCredentialGroupSettings,
  getCredentialGroupSettings,
  listCredentialGroupSettings,
} from '@/lib/credential-groups/application/manage-groups'

const workspaceContext = {
  workspaceId: 'workspace-1',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-1',
}
const sessionPrincipal: SessionPrincipal = {
  kind: 'session',
  userId: 'admin-1',
  sessionId: 'session-1',
}
const enrollmentPrincipal: CredentialGroupEnrollmentPrincipal = {
  kind: 'credential_group_enrollment',
  workspaceId: 'workspace-1',
  credentialGroupId: 'group-1',
  enrollmentId: 'enrollment-1',
  email: 'person@example.com',
  invitationTokenHash: 'hash-1',
}

describe('Credential Group Settings application operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveWorkspace.mockResolvedValue(workspaceContext)
    mocks.resolveGroup.mockResolvedValue({
      ...workspaceContext,
      credentialGroupId: 'group-1',
      name: 'Support',
    })
    mocks.resolvePermission.mockResolvedValue('admin')
    mocks.requireAvailable.mockResolvedValue(undefined)
    mocks.list.mockResolvedValue([])
    mocks.create.mockResolvedValue({ id: 'group-1', name: 'Support' })
    mocks.get.mockResolvedValue({ id: 'group-1', name: 'Support' })
    mocks.listEnrollments.mockResolvedValue({ enrollments: [], nextCursor: null })
  })

  it('rejects an enrollment bearer before loading workspace settings', async () => {
    await expect(
      listCredentialGroupSettings.execute({
        principal: enrollmentPrincipal,
        input: { workspaceId: 'workspace-1' },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.resolveWorkspace).not.toHaveBeenCalled()
  })

  it('requires current workspace-admin permission before listing', async () => {
    mocks.resolvePermission.mockResolvedValue('read')

    await expect(
      listCredentialGroupSettings.execute({
        principal: sessionPrincipal,
        input: { workspaceId: 'workspace-1' },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.list).not.toHaveBeenCalled()
  })

  it('lists settings only after authorization and entitlement checks', async () => {
    const result = await listCredentialGroupSettings.execute({
      principal: sessionPrincipal,
      input: { workspaceId: 'workspace-1' },
    })

    expect(mocks.requireAvailable).toHaveBeenCalledWith('workspace-1')
    expect(mocks.list).toHaveBeenCalledWith('workspace-1')
    expect(result).toEqual({ credentialGroups: [] })
  })

  it('derives created-by identity from the authenticated session principal', async () => {
    await createCredentialGroupSettings.execute({
      principal: sessionPrincipal,
      input: {
        workspaceId: 'workspace-1',
        credentialGroup: { name: 'Support', options: [] },
      },
    })

    expect(mocks.create).toHaveBeenCalledWith('workspace-1', 'admin-1', {
      name: 'Support',
      options: [],
    })
  })

  it('excludes deleted people from Credential Group settings', async () => {
    await getCredentialGroupSettings.execute({
      principal: sessionPrincipal,
      input: {
        assertedWorkspaceId: 'workspace-1',
        credentialGroupId: 'group-1',
        limit: 50,
      },
    })

    expect(mocks.listEnrollments).toHaveBeenCalledWith('workspace-1', 'group-1', 50, undefined, {
      statuses: ['invited', 'in_progress', 'completed', 'delivery_failed'],
    })
  })
})
