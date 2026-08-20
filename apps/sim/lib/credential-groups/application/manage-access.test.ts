/**
 * @vitest-environment node
 */
import type { SessionPrincipal } from '@sim/auth/principal'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadPolicy: vi.fn(),
  resolveGroup: vi.fn(),
  resolvePermission: vi.fn(),
  validateSubjects: vi.fn(),
  writePolicy: vi.fn(),
}))

vi.mock('@/lib/credential-groups/application/context', () => ({
  resolveCredentialGroupSettingsContext: mocks.resolveGroup,
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (permission: string | null, required: string) =>
    permission === 'admin' || permission === required,
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))

vi.mock('@/lib/resource-policies/management', () => ({
  validateResourcePolicySubjects: mocks.validateSubjects,
}))

vi.mock('@/lib/resource-policies/repository', () => {
  class ResourcePolicyRevisionConflictError extends Error {}
  return {
    loadResourcePolicy: mocks.loadPolicy,
    ResourcePolicyRevisionConflictError,
    writeResourcePolicy: mocks.writePolicy,
  }
})

import {
  readCredentialGroupAccess,
  updateCredentialGroupAccess,
} from '@/lib/credential-groups/application/manage-access'
import { ResourcePolicyRevisionConflictError } from '@/lib/resource-policies/repository'

const context = {
  workspaceId: 'workspace-1',
  workspaceOrganizationId: 'organization-1',
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
const target = {
  assertedWorkspaceId: 'workspace-1',
  credentialGroupId: 'group-1',
}

describe('Credential Group access policy operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveGroup.mockResolvedValue(context)
    mocks.resolvePermission.mockResolvedValue('admin')
    mocks.loadPolicy.mockResolvedValue(null)
    mocks.validateSubjects.mockResolvedValue(undefined)
    mocks.writePolicy.mockImplementation(async ({ document }) => ({
      id: 'policy-1',
      workspaceId: 'workspace-1',
      revision: 2,
      document,
      createdAt: new Date('2026-08-20T00:00:00.000Z'),
      updatedAt: new Date('2026-08-20T00:00:00.000Z'),
    }))
  })

  it('returns no visible grants when only the built-in self rule applies', async () => {
    await expect(readCredentialGroupAccess.execute({ principal, input: target })).resolves.toEqual({
      revision: 0,
      grants: [],
    })
  })

  it('fails fast when stored policy workspace binding is corrupt', async () => {
    mocks.loadPolicy.mockResolvedValue({
      id: 'policy-1',
      workspaceId: 'workspace-2',
      revision: 1,
      document: {
        version: 1,
        resource: { type: 'credential_group', id: 'group-1' },
        grants: [],
      },
      createdAt: new Date('2026-08-20T00:00:00.000Z'),
      updatedAt: new Date('2026-08-20T00:00:00.000Z'),
    })

    await expect(readCredentialGroupAccess.execute({ principal, input: target })).rejects.toThrow(
      'wrong workspace binding'
    )
  })

  it('requires current workspace-admin permission', async () => {
    mocks.resolvePermission.mockResolvedValue('write')

    await expect(
      updateCredentialGroupAccess.execute({
        principal,
        input: { ...target, expectedRevision: 0, grants: [] },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.writePolicy).not.toHaveBeenCalled()
  })

  it('stores one managed grant as list-and-use access to the whole group', async () => {
    const subject = { type: 'workflow' as const, workflowId: 'workflow-1' }

    const result = await updateCredentialGroupAccess.execute({
      principal,
      input: {
        ...target,
        expectedRevision: 1,
        grants: [{ subject }],
      },
    })

    expect(mocks.validateSubjects).toHaveBeenCalledWith([subject], context)
    expect(mocks.writePolicy).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      resourceType: 'credential_group',
      resourceId: 'group-1',
      expectedRevision: 1,
      actorUserId: 'admin-1',
      document: {
        version: 1,
        resource: { type: 'credential_group', id: 'group-1' },
        grants: [
          {
            id: expect.any(String),
            subject,
            actions: ['credential_groups.credentials.list', 'credential_groups.credentials.use'],
          },
        ],
      },
    })
    expect(result).toEqual({
      revision: 2,
      grants: [{ id: expect.any(String), subject }],
    })
  })

  it('maps optimistic-write conflicts to an application conflict', async () => {
    mocks.writePolicy.mockRejectedValue(new ResourcePolicyRevisionConflictError())

    await expect(
      updateCredentialGroupAccess.execute({
        principal,
        input: { ...target, expectedRevision: 1, grants: [] },
      })
    ).rejects.toMatchObject({ code: 'conflict' })
  })
})
