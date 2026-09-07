/**
 * @vitest-environment node
 */
import { permissionGroup, permissionGroupMember } from '@sim/db/schema'
import { queueTableRows, resetDbChainMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  findAllMembersWorkspaceConflict,
  findScopeConflicts,
} from '@/lib/permission-groups/application/group-membership'

afterAll(resetDbChainMock)

describe('findScopeConflicts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  const baseParams = {
    organizationId: 'org-1',
    excludeGroupId: 'group-1',
    workspaceIds: ['ws-1'],
    candidateUserIds: ['user-1'],
  }

  const conflictRow = (userId: string, otherGroupName = 'Marketing') => ({
    userId,
    userName: 'User One',
    userEmail: `${userId}@example.com`,
    otherGroupId: 'group-2',
    otherGroupName,
  })

  it('returns no conflicts when there are no candidate users', async () => {
    queueTableRows(permissionGroupMember, [conflictRow('user-1')])

    const conflicts = await findScopeConflicts({ ...baseParams, candidateUserIds: [] })

    expect(conflicts).toEqual([])
  })

  it('returns no conflicts when there are no target workspaces', async () => {
    queueTableRows(permissionGroupMember, [conflictRow('user-1')])

    const conflicts = await findScopeConflicts({ ...baseParams, workspaceIds: [] })

    expect(conflicts).toEqual([])
  })

  it('flags a candidate already in another group that shares a workspace', async () => {
    queueTableRows(permissionGroupMember, [conflictRow('user-1')])

    const conflicts = await findScopeConflicts(baseParams)

    expect(conflicts.map((c) => c.userId)).toEqual(['user-1'])
    expect(conflicts[0].conflictingGroupName).toBe('Marketing')
  })

  it('returns at most one conflict per user', async () => {
    queueTableRows(permissionGroupMember, [
      conflictRow('user-1', 'Marketing'),
      conflictRow('user-1', 'Sales'),
    ])

    const conflicts = await findScopeConflicts(baseParams)

    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].conflictingGroupName).toBe('Marketing')
  })

  it('returns no conflicts when the query finds no overlapping memberships', async () => {
    const conflicts = await findScopeConflicts(baseParams)

    expect(conflicts).toEqual([])
  })
})

describe('findAllMembersWorkspaceConflict', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  const baseParams = {
    organizationId: 'org-1',
    excludeGroupId: 'group-1',
    workspaceIds: ['ws-1', 'ws-2'],
  }

  it('returns null when there are no target workspaces', async () => {
    queueTableRows(permissionGroup, [
      { conflictingGroupId: 'group-2', conflictingGroupName: 'Marketing', workspaceName: 'Acme' },
    ])

    const conflict = await findAllMembersWorkspaceConflict({ ...baseParams, workspaceIds: [] })

    expect(conflict).toBeNull()
  })

  it('returns the conflicting all-members group sharing a workspace', async () => {
    queueTableRows(permissionGroup, [
      { conflictingGroupId: 'group-2', conflictingGroupName: 'Marketing', workspaceName: 'Acme' },
    ])

    const conflict = await findAllMembersWorkspaceConflict(baseParams)

    expect(conflict).toEqual({
      conflictingGroupId: 'group-2',
      conflictingGroupName: 'Marketing',
      workspaceName: 'Acme',
    })
  })

  it('returns null when no other all-members group targets the workspaces', async () => {
    const conflict = await findAllMembersWorkspaceConflict(baseParams)

    expect(conflict).toBeNull()
  })
})
