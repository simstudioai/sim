/** @vitest-environment node */
import type { SessionPrincipal } from '@sim/auth/principal'
import { dbChainMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  available: vi.fn(),
  group: vi.fn(),
  setup: vi.fn(),
  write: vi.fn(),
  policy: vi.fn(),
}))
vi.mock('@/lib/credential-groups/scoped-availability', () => ({
  isScopedCredentialGroupsAvailable: mocks.available,
}))
vi.mock('@/lib/credential-groups/credentials', () => ({
  loadScopedAccountsCredentialListContext: mocks.group,
}))
vi.mock('@/lib/credential-groups/organization-setup', () => ({
  requireOrganizationAccountsSetup: mocks.setup,
}))
vi.mock('@/lib/permission-groups/resolve.server', () => ({
  getUserPermissionConfigForOrganization: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/lib/credential-groups/service', () => ({
  ensureWorkspaceAccountsGroup: vi.fn(),
  getOrganizationAccountsGroup: vi.fn(),
  updateCredentialGroup: vi.fn(),
}))
vi.mock('@/lib/credential-groups/provider-availability', () => ({
  listConfiguredCredentialGroupProviders: vi.fn(),
}))
vi.mock('@/lib/credential-groups/self-enrollment', () => ({
  createViewerCredentialGroupEnrollment: vi.fn(),
}))
vi.mock('@/lib/resource-policies/repository', () => ({
  requireResourcePolicy: mocks.policy,
  writeResourcePolicy: mocks.write,
  ResourcePolicyRevisionConflictError: class extends Error {},
}))

import {
  getOrganizationAccountWorkspaceAccess,
  updateOrganizationAccountWorkspaceAccess,
} from '@/lib/credential-groups/application/organization-access'
import { buildOrganizationAccountAccessPolicy } from '@/lib/credential-groups/application/workspace-access-policy'
import { ResourcePolicyRevisionConflictError } from '@/lib/resource-policies/repository'

const principal: SessionPrincipal = {
  kind: 'session',
  userId: 'admin-user',
  sessionId: 'session-1',
}
const input = { organizationId: 'org-1', revision: 3, workspaceIds: ['workspace-1'] }

describe('organization workspace sharing administration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mocks.available.mockResolvedValue(true)
    mocks.group.mockResolvedValue({
      credentialGroupId: 'group-1',
      name: 'Accounts',
      status: 'active',
    })
    mocks.setup.mockResolvedValue(undefined)
    mocks.policy.mockResolvedValue({
      revision: 3,
      document: buildOrganizationAccountAccessPolicy('group-1', []),
    })
    mocks.write.mockImplementation(async ({ document }) => ({ revision: 4, document }))
  })

  it.each(['member', null])(
    'denies management by a %s before loading account data',
    async (role) => {
      queueTableRows(schemaMock.member, role ? [{ role }] : [])
      await expect(
        updateOrganizationAccountWorkspaceAccess.execute({ principal, input })
      ).rejects.toThrow()
      expect(mocks.group).not.toHaveBeenCalled()
      expect(mocks.write).not.toHaveBeenCalled()
    }
  )

  it('uses the routed org and checks every workspace before granting access', async () => {
    queueTableRows(schemaMock.member, [{ role: 'admin' }])
    queueTableRows(schemaMock.workspace, [{ id: 'workspace-1' }])
    await expect(
      updateOrganizationAccountWorkspaceAccess.execute({ principal, input })
    ).resolves.toMatchObject({ revision: 4, workspaceIds: ['workspace-1'] })
    expect(eq).toHaveBeenCalledWith(schemaMock.member.userId, 'admin-user')
    expect(eq).toHaveBeenCalledWith(schemaMock.member.organizationId, 'org-1')
    expect(eq).toHaveBeenCalledWith(schemaMock.workspace.organizationId, 'org-1')
    expect(mocks.write).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        actorUserId: 'admin-user',
        expectedRevision: 3,
      })
    )
  })

  it('refuses foreign or archived workspaces without writing a policy', async () => {
    queueTableRows(schemaMock.member, [{ role: 'owner' }])
    queueTableRows(schemaMock.workspace, [])
    await expect(
      updateOrganizationAccountWorkspaceAccess.execute({ principal, input })
    ).rejects.toThrow('Every allowed workspace')
    expect(mocks.write).not.toHaveBeenCalled()
  })

  it('supports revoking every workspace without a replacement workflow grant', async () => {
    queueTableRows(schemaMock.member, [{ role: 'admin' }])
    await expect(
      updateOrganizationAccountWorkspaceAccess.execute({
        principal,
        input: { ...input, workspaceIds: [] },
      })
    ).resolves.toMatchObject({ workspaceIds: [] })
    expect(mocks.write).toHaveBeenCalledWith(
      expect.objectContaining({ document: buildOrganizationAccountAccessPolicy('group-1', []) })
    )
  })

  it('rejects a stale revision rather than overwriting another admin', async () => {
    queueTableRows(schemaMock.member, [{ role: 'admin' }])
    mocks.write.mockRejectedValue(new ResourcePolicyRevisionConflictError())
    await expect(
      updateOrganizationAccountWorkspaceAccess.execute({
        principal,
        input: { ...input, workspaceIds: [] },
      })
    ).rejects.toMatchObject({ code: 'conflict' })
  })

  it('fails closed when the flag is disabled or legacy setup is unresolved', async () => {
    queueTableRows(schemaMock.member, [{ role: 'admin' }])
    mocks.available.mockResolvedValue(false)
    await expect(
      getOrganizationAccountWorkspaceAccess.execute({ principal, input })
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(mocks.group).not.toHaveBeenCalled()
    queueTableRows(schemaMock.member, [{ role: 'admin' }])
    mocks.available.mockResolvedValue(true)
    mocks.setup.mockRejectedValue(new Error('Migration review required'))
    await expect(
      getOrganizationAccountWorkspaceAccess.execute({ principal, input })
    ).rejects.toThrow('Migration review required')
    expect(dbChainMockFns.from).not.toHaveBeenCalledWith(schemaMock.workspace)
  })
})
