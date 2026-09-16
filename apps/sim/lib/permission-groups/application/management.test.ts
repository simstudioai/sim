/** @vitest-environment node */
import type { Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { member, permissionGroup, permissionGroupMember } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  governed: vi.fn(),
  load: vi.fn(),
  workspaces: vi.fn(),
  invalidWorkspaces: vi.fn(),
  scopeConflicts: vi.fn(),
  allConflict: vi.fn(),
  lock: vi.fn(),
  audit: vi.fn(),
  orgMember: vi.fn(),
}))
vi.mock('@sim/platform-authz/workspace', () => ({
  isOrgAdminRole: (role: string) => role === 'admin' || role === 'owner',
}))
vi.mock('@/lib/permission-groups/resolve.server', () => ({
  getUserPermissionConfigForOrganization: async () => null,
  isOrganizationPermissionRegimeActive: mocks.governed,
}))
vi.mock('@/lib/workspaces/permissions/utils', () => ({ isOrganizationMember: mocks.orgMember }))
vi.mock('@/lib/permission-groups/locks', () => ({ acquirePermissionGroupOrgLock: mocks.lock }))
vi.mock('@/lib/permission-groups/application/management-store', () => ({
  loadGroupInOrganization: mocks.load,
  getGroupWorkspaces: mocks.workspaces,
  findWorkspacesNotInOrganization: mocks.invalidWorkspaces,
  getWorkspacesForGroups: vi.fn(),
  listOrganizationWorkspaces: vi.fn(),
  formatScopeConflictError: () => 'Scope conflict',
  formatAllMembersConflictError: () => 'All members conflict',
}))
vi.mock('@/lib/permission-groups/application/group-membership', async (original) => ({
  ...(await original<typeof import('@/lib/permission-groups/application/group-membership')>()),
  findScopeConflicts: mocks.scopeConflicts,
  findAllMembersWorkspaceConflict: mocks.allConflict,
}))
vi.mock('@sim/audit', () => ({
  recordAudit: mocks.audit,
  AuditAction: {
    PERMISSION_GROUP_UPDATED: 'permission_group.updated',
    PERMISSION_GROUP_CREATED: 'permission_group.created',
    PERMISSION_GROUP_DELETED: 'permission_group.deleted',
    PERMISSION_GROUP_MEMBER_ADDED: 'permission_group.member.added',
    PERMISSION_GROUP_MEMBER_REMOVED: 'permission_group.member.removed',
  },
  AuditResourceType: { PERMISSION_GROUP: 'permission_group' },
}))

import { authorizePermissionGroupManagement } from '@/lib/permission-groups/application/authorized-management-use-case'
import {
  createPermissionGroup,
  deletePermissionGroup,
  updatePermissionGroup,
} from '@/lib/permission-groups/application/management'
import {
  addPermissionGroupMember,
  bulkAddPermissionGroupMembers,
  removePermissionGroupMember,
} from '@/lib/permission-groups/application/management-members'
import { permissionGroupManagementOperations } from '@/lib/permission-groups/application/management-operations'

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
  vi.clearAllMocks()
  resetDbChainMock()
  mocks.governed.mockResolvedValue(true)
  mocks.load.mockResolvedValue(group)
  mocks.workspaces.mockResolvedValue([{ id: 'workspace', name: 'Workspace' }])
  mocks.invalidWorkspaces.mockResolvedValue([])
  mocks.scopeConflicts.mockResolvedValue([])
  mocks.allConflict.mockResolvedValue(null)
  mocks.orgMember.mockResolvedValue(true)
})
describe('permission group current organization authority', () => {
  it.each(['owner', 'admin'])(
    'allows current %s for all registered management operations',
    async (role) => {
      for (const operation of Object.values(permissionGroupManagementOperations)) {
        queueTableRows(member, [{ role }])
        await expect(
          authorizePermissionGroupManagement(principal, operation, scope)
        ).resolves.toBeUndefined()
      }
    }
  )
  it.each(['member', null])(
    'refuses current role %s before entitlement and group lookup',
    async (role) => {
      queueTableRows(member, role ? [{ role }] : [])
      await expect(
        authorizePermissionGroupManagement(
          principal,
          permissionGroupManagementOperations.update,
          scope
        )
      ).rejects.toMatchObject({ code: 'forbidden' })
      expect(mocks.governed).not.toHaveBeenCalled()
      expect(mocks.load).not.toHaveBeenCalled()
    }
  )
  it.each<Principal>([
    { ...principal, organizationId: 'foreign' },
    { ...principal, audience: 'sim:search' },
    { ...principal, expiresAt: new Date(0) },
    { ...principal, resourceScope: { chatId: '' } },
    { kind: 'personal_api_key', userId: 'actor', keyId: 'key' },
    { kind: 'workspace_api_key', workspaceId: 'workspace', keyId: 'key' },
  ])('rejects invalid authority before canonical loading: %j', async (invalid) => {
    await expect(
      authorizePermissionGroupManagement(invalid, permissionGroupManagementOperations.update, scope)
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
    expect(mocks.load).not.toHaveBeenCalled()
  })
  it('requires an active permission regime after admin authority', async () => {
    queueTableRows(member, [{ role: 'admin' }])
    mocks.governed.mockResolvedValue(false)
    await expect(
      authorizePermissionGroupManagement(
        principal,
        permissionGroupManagementOperations.update,
        scope
      )
    ).rejects.toMatchObject({
      code: 'forbidden',
      message: 'Access Control is an Enterprise feature',
    })
    expect(mocks.load).not.toHaveBeenCalled()
  })
  it('allows administrators to manage a governed organization even when its plan is past due', async () => {
    queueTableRows(member, [{ role: 'admin' }])
    mocks.governed.mockResolvedValue(true)
    await expect(
      authorizePermissionGroupManagement(
        principal,
        permissionGroupManagementOperations.update,
        scope
      )
    ).resolves.toBeUndefined()
    expect(mocks.governed).toHaveBeenCalledWith('org')
  })
  it('propagates permission-regime read failures instead of granting access', async () => {
    queueTableRows(member, [{ role: 'admin' }])
    mocks.governed.mockRejectedValueOnce(new Error('policy unavailable'))
    await expect(
      authorizePermissionGroupManagement(
        principal,
        permissionGroupManagementOperations.update,
        scope
      )
    ).rejects.toThrow('policy unavailable')
    expect(mocks.load).not.toHaveBeenCalled()
  })
  it('conceals a group outside its canonical organization', async () => {
    queueTableRows(member, [{ role: 'admin' }])
    mocks.load.mockResolvedValue(null)
    await expect(
      authorizePermissionGroupManagement(principal, permissionGroupManagementOperations.get, scope)
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(mocks.load).toHaveBeenCalledWith('group', 'org')
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
        input: { ...scope, settings: { workspaceIds: ['workspace'] } },
      })
      expect(mocks.lock).toHaveBeenCalledBefore(mocks.scopeConflicts)
      expect(mocks.load).toHaveBeenLastCalledWith('group', 'org', db)
      expect(mocks.allConflict).toHaveBeenCalledTimes(membershipMode === 'inherit' ? 1 : 0)
      expect(result.permissionGroup.name).toBe('Authoritative name')
      expect(mocks.audit).toHaveBeenCalledWith(
        expect.objectContaining({ actorId: 'actor', resourceName: 'Authoritative name' })
      )
    }
  )
  it('propagates transaction failure without semantic audit', async () => {
    queueTableRows(member, [{ role: 'admin' }])
    mocks.lock.mockRejectedValueOnce(new Error('storage unavailable'))
    await expect(
      updatePermissionGroup.execute({
        principal,
        input: { ...scope, settings: { description: 'Change' } },
      })
    ).rejects.toThrow('storage unavailable')
    expect(mocks.audit).not.toHaveBeenCalled()
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })
})

describe('permission group membership mutations', () => {
  it('creates a scoped group with the delegated actor as creator', async () => {
    queueTableRows(member, [{ role: 'owner' }])
    queueTableRows(permissionGroup, [])
    const result = await createPermissionGroup.execute({
      principal,
      input: {
        organizationId: 'org',
        settings: { name: 'New group', workspaceIds: ['workspace', 'workspace'] },
      },
    })
    expect(result.permissionGroup).toMatchObject({
      createdBy: 'actor',
      workspaceIds: ['workspace'],
    })
    expect(mocks.lock).toHaveBeenCalledBefore(mocks.allConflict)
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: 'actor', resourceName: 'New group' })
    )
  })
  it('deletes under the organization lock and audits the locked record', async () => {
    queueTableRows(member, [{ role: 'owner' }])
    await expect(deletePermissionGroup.execute({ principal, input: scope })).resolves.toMatchObject(
      { success: true, groupName: 'Directory group' }
    )
    expect(mocks.load).toHaveBeenLastCalledWith('group', 'org', db)
    expect(dbChainMockFns.delete).toHaveBeenCalledTimes(2)
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: 'actor', resourceName: 'Directory group' })
    )
  })
  it('adds a current organization member under a lock with the real assigner', async () => {
    queueTableRows(member, [{ role: 'admin' }])
    queueTableRows(permissionGroupMember, [])
    const result = await addPermissionGroupMember.execute({
      principal,
      input: { ...scope, userId: 'target' },
    })
    expect(result.member).toMatchObject({
      userId: 'target',
      assignedBy: 'actor',
      organizationId: 'org',
    })
    expect(mocks.orgMember).toHaveBeenCalledWith('target', 'org')
    expect(mocks.lock).toHaveBeenCalledBefore(mocks.scopeConflicts)
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ actorId: 'actor' }))
  })
  it('rejects targets outside the organization before mutation', async () => {
    queueTableRows(member, [{ role: 'admin' }])
    mocks.orgMember.mockResolvedValue(false)
    await expect(
      addPermissionGroupMember.execute({ principal, input: { ...scope, userId: 'foreign' } })
    ).rejects.toMatchObject({ code: 'validation' })
    expect(dbChainMockFns.transaction).not.toHaveBeenCalled()
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
    expect(result).toMatchObject({ success: true, userId: 'target' })
    expect(mocks.allConflict).not.toHaveBeenCalled()
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ targetUserId: 'target' }) })
    )
  })
  it('bulk-adds only distinct current organization members and counts existing members', async () => {
    queueTableRows(member, [{ role: 'admin' }])
    queueTableRows(member, [{ userId: 'existing' }, { userId: 'new' }, { userId: 'new' }])
    queueTableRows(permissionGroupMember, [{ userId: 'existing' }])
    const result = await bulkAddPermissionGroupMembers.execute({
      principal,
      input: { ...scope, userIds: ['existing', 'new', 'new', 'foreign'] },
    })
    expect(result).toMatchObject({ added: 1, skipped: 1, addedUserIds: ['new'] })
    expect(dbChainMockFns.values).toHaveBeenCalledWith([
      expect.objectContaining({ userId: 'new', assignedBy: 'actor' }),
    ])
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ addedUserIds: ['new'] }) })
    )
  })
  it('emits no audit when a bulk add changes nothing', async () => {
    queueTableRows(member, [{ role: 'admin' }])
    queueTableRows(member, [{ userId: 'existing' }])
    queueTableRows(permissionGroupMember, [{ userId: 'existing' }])
    await expect(
      bulkAddPermissionGroupMembers.execute({
        principal,
        input: { ...scope, userIds: ['existing'] },
      })
    ).resolves.toMatchObject({ added: 0, skipped: 1 })
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
  })
})
