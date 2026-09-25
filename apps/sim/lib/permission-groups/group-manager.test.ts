import { db } from '@sim/db'
import { permissionGroup, permissionGroupMember } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  lock: vi.fn(),
  group: vi.fn(),
  workspaces: vi.fn(),
  invalidWorkspaces: vi.fn(),
  allConflict: vi.fn(),
  scopeConflicts: vi.fn(),
}))
vi.mock('@/lib/billing/organizations/membership', () => ({
  acquireOrganizationMutationLock: vi.fn(),
}))
vi.mock('@/lib/permission-groups/resolve.server', () => ({
  isOrganizationPermissionRegimeActive: vi.fn().mockResolvedValue(true),
}))
vi.mock('@/lib/permission-groups/locks', () => ({ acquirePermissionGroupOrgLock: mocks.lock }))
vi.mock('@/lib/permission-groups/repository', () => ({
  loadGroupInOrganization: mocks.group,
  getGroupWorkspaces: mocks.workspaces,
  findWorkspacesNotInOrganization: mocks.invalidWorkspaces,
}))
vi.mock('@/lib/permission-groups/application/group-membership', () => ({
  findAllMembersWorkspaceConflict: mocks.allConflict,
  findScopeConflicts: mocks.scopeConflicts,
}))

import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'
import {
  createPermissionGroupRecord,
  deletePermissionGroupRecord,
  updatePermissionGroupRecord,
} from '@/lib/permission-groups/group-manager'

const group = {
  id: 'group-1',
  organizationId: 'org-1',
  name: 'Restricted',
  description: null,
  createdBy: 'admin-1',
  createdAt: new Date(),
  updatedAt: new Date(),
  isDefault: false,
  membershipMode: 'inherit',
  config: DEFAULT_PERMISSION_GROUP_CONFIG,
}

beforeEach(() => {
  resetDbChainMock()
  mocks.group.mockResolvedValue(group)
  mocks.workspaces.mockResolvedValue([{ id: 'workspace-1', name: 'Engineering' }])
  mocks.invalidWorkspaces.mockResolvedValue([])
  mocks.allConflict.mockResolvedValue(null)
  mocks.scopeConflicts.mockResolvedValue([])
  dbChainMockFns.returning.mockResolvedValue([{ ...group }])
})

describe('permission group mutation consistency', () => {
  it('accepts an explicitly empty workspace scope when promoting the default', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([{ ...group, isDefault: true }])
    const result = await updatePermissionGroupRecord('org-1', 'group-1', {
      isDefault: true,
      workspaceIds: [],
    })
    expect(result).toMatchObject({ isDefault: true, workspaceIds: [] })
    expect(dbChainMockFns.delete).toHaveBeenCalledOnce()
  })

  it('reads default state only after acquiring the organization lock', async () => {
    const entered = Promise.withResolvers<void>()
    const released = Promise.withResolvers<void>()
    mocks.lock.mockImplementationOnce(() => {
      entered.resolve()
      return released.promise
    })
    const update = updatePermissionGroupRecord('org-1', 'group-1', {
      workspaceIds: ['workspace-2'],
    })
    await entered.promise
    expect(mocks.group).not.toHaveBeenCalled()
    mocks.group.mockResolvedValueOnce({ ...group, isDefault: true })
    released.resolve()
    await expect(update).rejects.toMatchObject({ code: 'validation' })
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('demotes a default to an inactive scope when no workspace list is supplied', async () => {
    mocks.group.mockResolvedValueOnce({ ...group, isDefault: true })
    const result = await updatePermissionGroupRecord('org-1', 'group-1', { isDefault: false })
    expect(result.workspaceIds).toEqual([])
    expect(mocks.workspaces).not.toHaveBeenCalled()
    expect(dbChainMockFns.delete).toHaveBeenCalledOnce()
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })

  it('does not classify an empty explicit group as an all-member group', async () => {
    mocks.group.mockResolvedValueOnce({ ...group, membershipMode: 'explicit' })
    await updatePermissionGroupRecord('org-1', 'group-1', { workspaceIds: ['workspace-2'] })
    expect(mocks.allConflict).not.toHaveBeenCalled()
  })

  it('rejects overlapping members before changing scope', async () => {
    queueTableRows(permissionGroupMember, [{ userId: 'member-1' }])
    mocks.scopeConflicts.mockResolvedValueOnce([
      { userName: 'Member', conflictingGroupName: 'Other group' },
    ])
    await expect(
      updatePermissionGroupRecord('org-1', 'group-1', { workspaceIds: ['workspace-2'] })
    ).rejects.toMatchObject({ code: 'conflict' })
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
    expect(dbChainMockFns.delete).not.toHaveBeenCalled()
  })

  it('rejects a conflicting inherited scope without mutation', async () => {
    mocks.allConflict.mockResolvedValueOnce({
      conflictingGroupName: 'Other',
      workspaceName: 'Engineering',
    })
    await expect(
      updatePermissionGroupRecord('org-1', 'group-1', { workspaceIds: ['workspace-2'] })
    ).rejects.toMatchObject({ code: 'conflict' })
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('rejects a duplicate name without demoting the current default', async () => {
    queueTableRows(permissionGroup, [{ id: 'other-group' }])
    await expect(
      createPermissionGroupRecord('org-1', 'admin-1', { name: 'Restricted', isDefault: true })
    ).rejects.toMatchObject({ code: 'conflict' })
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('deletes only after finding the group in the asserted organization under lock', async () => {
    mocks.group.mockResolvedValueOnce(null)
    await expect(deletePermissionGroupRecord('org-1', 'other-group')).rejects.toMatchObject({
      code: 'not_found',
    })
    expect(mocks.group).toHaveBeenCalledWith('other-group', 'org-1', db)
    expect(dbChainMockFns.delete).not.toHaveBeenCalled()
  })
})
