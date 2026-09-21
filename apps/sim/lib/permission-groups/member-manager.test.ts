/** @vitest-environment node */
import { member, permissionGroupMember } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  group: vi.fn(),
  workspaces: vi.fn(),
  allConflict: vi.fn(),
  scopeConflicts: vi.fn(),
}))
vi.mock('@/lib/billing/organizations/membership', () => ({
  acquireOrganizationMutationLock: vi.fn(),
}))
vi.mock('@/lib/permission-groups/resolve.server', () => ({
  isOrganizationPermissionRegimeActive: vi.fn().mockResolvedValue(true),
}))
vi.mock('@/lib/permission-groups/locks', () => ({ acquirePermissionGroupOrgLock: vi.fn() }))
vi.mock('@/lib/permission-groups/group-manager', () => ({ requirePermissionGroup: mocks.group }))
vi.mock('@/lib/permission-groups/repository', () => ({ getGroupWorkspaces: mocks.workspaces }))
vi.mock('@/lib/permission-groups/application/group-membership', () => ({
  findAllMembersWorkspaceConflict: mocks.allConflict,
  findScopeConflicts: mocks.scopeConflicts,
}))

import {
  addPermissionGroupMemberRecord,
  bulkAddPermissionGroupMemberRecords,
  removePermissionGroupMemberRecord,
} from '@/lib/permission-groups/member-manager'

const group = { id: 'group-1', name: 'Restricted', isDefault: false, membershipMode: 'inherit' }
beforeEach(() => {
  vi.clearAllMocks()
  resetDbChainMock()
  mocks.group.mockResolvedValue(group)
  mocks.workspaces.mockResolvedValue([{ id: 'workspace-1' }])
  mocks.allConflict.mockResolvedValue(null)
  mocks.scopeConflicts.mockResolvedValue([])
})

describe('permission-group membership mutations', () => {
  it('requires organization membership for a single addition', async () => {
    await expect(
      addPermissionGroupMemberRecord('org-1', 'group-1', 'outsider', 'admin-1')
    ).rejects.toMatchObject({ code: 'validation' })
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })
  it('refuses duplicate assignments', async () => {
    queueTableRows(member, [{ id: 'org-member-1' }])
    queueTableRows(permissionGroupMember, [{ id: 'assignment-1' }])
    await expect(
      addPermissionGroupMemberRecord('org-1', 'group-1', 'member-1', 'admin-1')
    ).rejects.toMatchObject({ code: 'conflict' })
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })
  it('checks overlap before writing a single assignment', async () => {
    queueTableRows(member, [{ id: 'org-member-1' }])
    mocks.scopeConflicts.mockResolvedValue([{ userName: 'Member', conflictingGroupName: 'Other' }])
    await expect(
      addPermissionGroupMemberRecord('org-1', 'group-1', 'member-1', 'admin-1')
    ).rejects.toMatchObject({ code: 'conflict' })
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })
  it.each([false, true])(
    'retains assignments and the actual actor for isDefault=%s',
    async (isDefault) => {
      mocks.group.mockResolvedValue({ ...group, isDefault })
      if (isDefault) mocks.workspaces.mockResolvedValue([])
      queueTableRows(member, [{ id: 'org-member-1' }])
      const result = await addPermissionGroupMemberRecord('org-1', 'group-1', 'member-1', 'admin-1')
      expect(result.member).toMatchObject({
        userId: 'member-1',
        assignedBy: 'admin-1',
        organizationId: 'org-1',
        permissionGroupId: 'group-1',
      })
    }
  )
  it('rejects the entire bulk selection on a membership overlap', async () => {
    queueTableRows(member, [{ userId: 'member-1' }, { userId: 'member-2' }])
    mocks.scopeConflicts.mockResolvedValue([{ userName: 'Member', conflictingGroupName: 'Other' }])
    await expect(
      bulkAddPermissionGroupMemberRecords(
        'org-1',
        'group-1',
        { userIds: ['member-1', 'member-2'] },
        'admin-1'
      )
    ).rejects.toMatchObject({ code: 'conflict' })
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })
  it('deduplicates, ignores outsiders and skips current assignments', async () => {
    queueTableRows(member, [{ userId: 'member-1' }, { userId: 'member-2' }])
    queueTableRows(permissionGroupMember, [{ userId: 'member-1' }])
    const result = await bulkAddPermissionGroupMemberRecords(
      'org-1',
      'group-1',
      { userIds: ['member-1', 'member-2', 'member-2', 'outsider'] },
      'admin-1'
    )
    expect(result).toMatchObject({ added: 1, skipped: 1, addedUserIds: ['member-2'] })
    expect(dbChainMockFns.values).toHaveBeenCalledWith([
      expect.objectContaining({ userId: 'member-2', assignedBy: 'admin-1' }),
    ])
  })
  it('adds a large organization in bounded batches within one transaction', async () => {
    queueTableRows(
      member,
      Array.from({ length: 1000 }, (_, index) => ({ userId: `member-${index}` }))
    )
    queueTableRows(member, [{ userId: 'member-last' }])
    const result = await bulkAddPermissionGroupMemberRecords(
      'org-1',
      'group-1',
      { addAllOrganizationMembers: true },
      'admin-1'
    )
    expect(result).toMatchObject({ added: 1001, skipped: 0 })
    expect(result.addedUserIds).toHaveLength(1000)
    expect(dbChainMockFns.transaction).toHaveBeenCalledOnce()
    expect(dbChainMockFns.limit.mock.calls).toEqual([[1000], [1000]])
    expect(dbChainMockFns.values.mock.calls.map(([rows]) => rows.length)).toEqual([1000, 1])
  })

  it('keeps a conflict on a later batch inside the same rollback boundary', async () => {
    queueTableRows(
      member,
      Array.from({ length: 1000 }, (_, index) => ({ userId: `member-${index}` }))
    )
    queueTableRows(member, [{ userId: 'member-last' }])
    mocks.scopeConflicts
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ userName: 'Member', conflictingGroupName: 'Other' }])
    await expect(
      bulkAddPermissionGroupMemberRecords(
        'org-1',
        'group-1',
        { addAllOrganizationMembers: true },
        'admin-1'
      )
    ).rejects.toMatchObject({ code: 'conflict' })
    expect(dbChainMockFns.transaction).toHaveBeenCalledOnce()
    expect(dbChainMockFns.insert).toHaveBeenCalledOnce()
  })

  it('will not expand the last-member removal into an overlapping all-member scope', async () => {
    queueTableRows(permissionGroupMember, [{ id: 'assignment-1', userId: 'member-1', email: null }])
    queueTableRows(permissionGroupMember, [{ value: 1 }])
    mocks.allConflict.mockResolvedValue({
      conflictingGroupName: 'Other',
      workspaceName: 'Engineering',
    })
    await expect(
      removePermissionGroupMemberRecord('org-1', 'group-1', 'assignment-1')
    ).rejects.toMatchObject({ code: 'conflict' })
    expect(dbChainMockFns.delete).not.toHaveBeenCalled()
  })
  it('can empty a group in explicit membership mode', async () => {
    mocks.group.mockResolvedValue({ ...group, membershipMode: 'explicit' })
    queueTableRows(permissionGroupMember, [{ id: 'assignment-1', userId: 'member-1', email: null }])
    await removePermissionGroupMemberRecord('org-1', 'group-1', 'assignment-1')
    expect(mocks.allConflict).not.toHaveBeenCalled()
    expect(dbChainMockFns.delete).toHaveBeenCalledOnce()
  })
  it('does not delete an assignment absent from the requested group', async () => {
    await expect(
      removePermissionGroupMemberRecord('org-1', 'group-1', 'other-assignment')
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(dbChainMockFns.delete).not.toHaveBeenCalled()
  })
})
