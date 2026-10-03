import { db } from '@sim/db'
import { permissionGroup, permissionGroupMember, permissionGroupWorkspace } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import {
  permissionGroupLocksMock,
  permissionGroupLocksMockFns,
} from '@sim/testing/mocks/permission-group-locks.mock'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/permission-groups/locks', () => permissionGroupLocksMock)

import {
  addPermissionGroupMemberTx,
  findAllMembersWorkspaceConflict,
  findScopeConflicts,
  PermissionGroupAllMembersConflictError,
  PermissionGroupNotFoundError,
  PermissionGroupScopeConflictError,
  removePermissionGroupMemberTx,
} from '@/lib/permission-groups/application/group-membership'

const mocks = { acquireLock: permissionGroupLocksMockFns.mockAcquirePermissionGroupOrgLock }

afterAll(resetDbChainMock)

describe('findScopeConflicts', () => {
  beforeEach(() => {
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
})

describe('findAllMembersWorkspaceConflict', () => {
  beforeEach(() => {
    resetDbChainMock()
  })

  const baseParams = {
    organizationId: 'org-1',
    excludeGroupId: 'group-1',
    workspaceIds: ['ws-1', 'ws-2'],
  }

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
})

const memberParams = { organizationId: 'org-1', groupId: 'group-1', userId: 'user-1' }

/** Queues the group row and its workspace rows that `loadLockedGroup` reads, in that order. */
function stageGroup(
  group: { isDefault?: boolean; membershipMode?: 'inherit' | 'explicit' } | null,
  workspaceIds: string[] = ['ws-1']
) {
  queueTableRows(
    permissionGroup,
    group
      ? [
          {
            id: 'group-1',
            isDefault: group.isDefault ?? false,
            membershipMode: group.membershipMode ?? 'inherit',
          },
        ]
      : []
  )
  if (group) {
    queueTableRows(
      permissionGroupWorkspace,
      workspaceIds.map((workspaceId) => ({ workspaceId }))
    )
  }
}

describe('addPermissionGroupMemberTx', () => {
  beforeEach(() => {
    resetDbChainMock()
    mocks.acquireLock.mockResolvedValue(undefined)
  })

  it('takes the leaf lock with the timeout already bounded before reading or writing anything', async () => {
    stageGroup({})
    queueTableRows(permissionGroupMember, [])
    queueTableRows(permissionGroupMember, [])

    const result = await addPermissionGroupMemberTx(db, memberParams)

    expect(result).toBe('added')
    expect(mocks.acquireLock).toHaveBeenCalledWith(db, 'org-1', {
      lockTimeoutAlreadyBounded: true,
    })
    expect(mocks.acquireLock.mock.invocationCallOrder[0]).toBeLessThan(
      dbChainMockFns.from.mock.invocationCallOrder[0]
    )
    expect(mocks.acquireLock.mock.invocationCallOrder[0]).toBeLessThan(
      dbChainMockFns.insert.mock.invocationCallOrder[0]
    )
  })

  it('refuses a user another group already governs on a shared workspace, inserting nothing', async () => {
    stageGroup({})
    queueTableRows(permissionGroupMember, [])
    queueTableRows(permissionGroupMember, [
      {
        userId: 'user-1',
        userName: 'User One',
        userEmail: 'user-1@example.com',
        otherGroupId: 'group-2',
        otherGroupName: 'Marketing',
      },
    ])

    const error = await addPermissionGroupMemberTx(db, memberParams).catch((caught) => caught)

    expect(error).toBeInstanceOf(PermissionGroupScopeConflictError)
    expect(error.conflicts).toEqual([
      {
        userId: 'user-1',
        userName: 'User One',
        userEmail: 'user-1@example.com',
        conflictingGroupId: 'group-2',
        conflictingGroupName: 'Marketing',
      },
    ])
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })

  it('throws not-found for a group outside the organization, after taking the lock', async () => {
    stageGroup(null)

    const error = await addPermissionGroupMemberTx(db, memberParams).catch((caught) => caught)

    expect(error).toBeInstanceOf(PermissionGroupNotFoundError)
    expect(mocks.acquireLock).toHaveBeenCalledTimes(1)
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })
})

describe('removePermissionGroupMemberTx', () => {
  beforeEach(() => {
    resetDbChainMock()
    mocks.acquireLock.mockResolvedValue(undefined)
  })

  const allMembersConflict = {
    conflictingGroupId: 'group-2',
    conflictingGroupName: 'Marketing',
    workspaceName: 'Acme',
  }

  it('refuses to empty an inherit-mode group when another all-members group shares a workspace', async () => {
    stageGroup({ membershipMode: 'inherit' })
    queueTableRows(permissionGroupMember, [{ id: 'pgm-1' }])
    queueTableRows(permissionGroupMember, [{ value: 1 }])
    queueTableRows(permissionGroup, [allMembersConflict])

    const error = await removePermissionGroupMemberTx(db, memberParams).catch((caught) => caught)

    expect(error).toBeInstanceOf(PermissionGroupAllMembersConflictError)
    expect(error.conflict).toEqual(allMembersConflict)
    expect(dbChainMockFns.delete).not.toHaveBeenCalled()
  })

  it('removes the last member of an inherit-mode group when no other group claims its workspaces', async () => {
    stageGroup({ membershipMode: 'inherit' })
    queueTableRows(permissionGroupMember, [{ id: 'pgm-1' }])
    queueTableRows(permissionGroupMember, [{ value: 1 }])
    queueTableRows(permissionGroup, [])

    const result = await removePermissionGroupMemberTx(db, memberParams)

    expect(result).toBe('removed')
    expect(dbChainMockFns.delete).toHaveBeenCalledWith(permissionGroupMember)
  })

  it('throws not-found for a group outside the organization, deleting nothing', async () => {
    stageGroup(null)

    const error = await removePermissionGroupMemberTx(db, memberParams).catch((caught) => caught)

    expect(error).toBeInstanceOf(PermissionGroupNotFoundError)
    expect(dbChainMockFns.delete).not.toHaveBeenCalled()
  })
})
