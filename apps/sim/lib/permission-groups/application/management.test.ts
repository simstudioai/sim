import type { Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { member, permissionGroupMember } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { createWorkspaceApiKeyPrincipal } from '@sim/testing/factories/principal.factory'
import { auditMock, auditMockFns } from '@sim/testing/mocks/audit.mock'
import {
  permissionGroupLocksMock,
  permissionGroupLocksMockFns,
} from '@sim/testing/mocks/permission-group-locks.mock'
import {
  permissionGroupsResolveMock,
  permissionGroupsResolveMockFns,
} from '@sim/testing/mocks/permission-groups-resolve.mock'
import { workspaceAuthzMock } from '@sim/testing/mocks/workspace-authz.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  load: vi.fn(),
  workspaces: vi.fn(),
  invalidWorkspaces: vi.fn(),
  scopeConflicts: vi.fn(),
  allConflict: vi.fn(),
}))
vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)
vi.mock('@/lib/permission-groups/resolve.server', () => permissionGroupsResolveMock)
vi.mock('@/lib/permission-groups/locks', () => permissionGroupLocksMock)
vi.mock('@/lib/permission-groups/repository', () => ({
  loadGroupInOrganization: hoisted.load,
  getGroupWorkspaces: hoisted.workspaces,
  findWorkspacesNotInOrganization: hoisted.invalidWorkspaces,
  getWorkspacesForGroups: vi.fn(),
  listOrganizationWorkspaces: vi.fn(),
  formatScopeConflictError: () => 'Scope conflict',
  formatAllMembersConflictError: () => 'All members conflict',
}))
vi.mock('@/lib/permission-groups/application/group-membership', async (original) => ({
  ...(await original<typeof import('@/lib/permission-groups/application/group-membership')>()),
  findScopeConflicts: hoisted.scopeConflicts,
  findAllMembersWorkspaceConflict: hoisted.allConflict,
}))
vi.mock('@sim/audit', () => auditMock)

import {
  addPermissionGroupMember,
  getPermissionGroup,
  removePermissionGroupMember,
  updatePermissionGroup,
} from '@/lib/permission-groups/application/use-cases'

const mocks = {
  ...hoisted,
  lock: permissionGroupLocksMockFns.mockAcquirePermissionGroupOrgLock,
  governed: permissionGroupsResolveMockFns.mockIsOrganizationPermissionRegimeActive,
  audit: auditMockFns.mockRecordAudit,
}

const principal = {
  kind: 'organization_delegated',
  serviceId: 'copilot',
  subjectUserId: 'actor',
  organizationId: 'org',
  delegationId: 'management',
  audience: 'sim:settings',
  issuedAt: new Date(),
  expiresAt: new Date(Date.now() + 60_000),
  resourceScope: { chatId: 'chat' },
} as const
const scope = { organizationId: 'org', groupId: 'group' }
const group = {
  ...scope,
  id: 'group',
  name: 'Directory group',
  description: null,
  isDefault: false,
  membershipMode: 'explicit',
  config: {},
  createdBy: 'creator',
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
}
beforeEach(() => {
  resetDbChainMock()
  mocks.governed.mockResolvedValue(true)
  mocks.load.mockResolvedValue(group)
  mocks.workspaces.mockResolvedValue([{ id: 'workspace', name: 'Workspace' }])
  mocks.invalidWorkspaces.mockResolvedValue([])
  mocks.scopeConflicts.mockResolvedValue([])
  mocks.allConflict.mockResolvedValue(null)
})
describe('permission group current organization authority', () => {
  it.each(['member', null])('refuses role %s before entitlement and group lookup', async (role) => {
    queueTableRows(member, role ? [{ role }] : [])
    await expect(getPermissionGroup.execute({ principal, input: scope })).rejects.toThrow()
    expect(mocks.governed).not.toHaveBeenCalled()
    expect(mocks.load).not.toHaveBeenCalled()
  })
  it.each<Principal>([
    { ...principal, organizationId: 'foreign' },
    { ...principal, audience: 'sim:search' },
    { ...principal, expiresAt: new Date(0) },
    { ...principal, resourceScope: { chatId: '' } },
    createWorkspaceApiKeyPrincipal({ workspaceId: 'workspace', keyId: 'key' }),
  ])('rejects invalid authority before canonical loading: %j', async (invalid) => {
    await expect(
      getPermissionGroup.execute({ principal: invalid, input: scope })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
    expect(mocks.load).not.toHaveBeenCalled()
  })
  it('requires the permission regime after admin authority', async () => {
    queueTableRows(member, [{ role: 'admin' }])
    mocks.governed.mockResolvedValue(false)
    await expect(getPermissionGroup.execute({ principal, input: scope })).rejects.toMatchObject({
      detailCode: 'ENTERPRISE_PLAN_REQUIRED',
    })
    expect(mocks.load).not.toHaveBeenCalled()
  })
  it('conceals a group outside its canonical organization', async () => {
    queueTableRows(member, [{ role: 'admin' }])
    mocks.load.mockResolvedValue(null)
    await expect(getPermissionGroup.execute({ principal, input: scope })).rejects.toMatchObject({
      code: 'not_found',
    })
    expect(mocks.load).toHaveBeenCalledWith('group', 'org', expect.anything())
  })
})
describe('permission group locked scope changes', () => {
  it.each(['explicit', 'inherit'])(
    'preserves empty %s membership semantics',
    async (membershipMode) => {
      queueTableRows(member, [{ role: 'admin' }])
      queueTableRows(permissionGroupMember, [])
      mocks.load.mockResolvedValue({ ...group, membershipMode })
      dbChainMockFns.returning.mockResolvedValueOnce([
        { ...group, membershipMode, name: 'Authoritative name' },
      ])
      const result = await updatePermissionGroup.execute({
        principal,
        input: { ...scope, changes: { workspaceIds: ['workspace'] } },
      })
      expect(mocks.lock).toHaveBeenCalledBefore(mocks.scopeConflicts)
      expect(mocks.load).toHaveBeenLastCalledWith('group', 'org', db)
      expect(mocks.allConflict).toHaveBeenCalledTimes(membershipMode === 'inherit' ? 1 : 0)
      expect(result.name).toBe('Authoritative name')
      expect(mocks.audit).toHaveBeenCalledWith(
        expect.objectContaining({ actorId: 'actor', resourceName: 'Authoritative name' })
      )
    }
  )
})

describe('permission group membership mutations', () => {
  it('rejects targets outside the organization before mutation', async () => {
    queueTableRows(member, [{ role: 'admin' }])
    queueTableRows(member, [])
    await expect(
      addPermissionGroupMember.execute({ principal, input: { ...scope, userId: 'foreign' } })
    ).rejects.toMatchObject({ code: 'validation' })
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
  })
  it('removes an explicit SCIM group last member without treating it as all members', async () => {
    queueTableRows(member, [{ role: 'admin' }])
    queueTableRows(permissionGroupMember, [
      { id: 'membership', userId: 'target', email: 'target@example.com' },
    ])
    const result = await removePermissionGroupMember.execute({
      principal,
      input: { ...scope, memberId: 'membership' },
    })
    expect(result).toMatchObject({ member: { userId: 'target' } })
    expect(mocks.allConflict).not.toHaveBeenCalled()
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ targetUserId: 'target' }) })
    )
  })
})
