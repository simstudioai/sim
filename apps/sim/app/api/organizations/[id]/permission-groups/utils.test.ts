/**
 * @vitest-environment node
 */
import { permissionGroup, permissionGroupMember } from '@sim/db/schema'
import { dbChainMock, queueTableRows, resetDbChainMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockIsOrganizationAdminOrOwner, mockIsOrganizationOnEnterprisePlan } = vi.hoisted(() => ({
  mockIsOrganizationAdminOrOwner: vi.fn<() => Promise<boolean>>(),
  mockIsOrganizationOnEnterprisePlan: vi.fn<() => Promise<boolean>>(),
}))

vi.mock('@/lib/billing', () => ({
  isOrganizationOnEnterprisePlan: mockIsOrganizationOnEnterprisePlan,
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  isOrganizationAdminOrOwner: mockIsOrganizationAdminOrOwner,
}))

vi.mock('@sim/db', () => dbChainMock)

import {
  authorizeOrgAccessControl,
  findAllMembersWorkspaceConflict,
  findScopeConflicts,
} from '@/app/api/organizations/[id]/permission-groups/utils'

afterAll(resetDbChainMock)

describe('authorizeOrgAccessControl', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('returns a 403 when the user is not an organization admin/owner', async () => {
    mockIsOrganizationAdminOrOwner.mockResolvedValue(false)
    mockIsOrganizationOnEnterprisePlan.mockResolvedValue(true)

    const response = await authorizeOrgAccessControl('user-1', 'org-1')

    expect(response).not.toBeNull()
    expect(response?.status).toBe(403)
    await expect(response?.json()).resolves.toEqual({ error: 'Admin permissions required' })
    // Entitlement is only checked after the admin gate passes.
    expect(mockIsOrganizationOnEnterprisePlan).not.toHaveBeenCalled()
  })

  it('returns a 403 when the organization is not on an enterprise plan', async () => {
    mockIsOrganizationAdminOrOwner.mockResolvedValue(true)
    mockIsOrganizationOnEnterprisePlan.mockResolvedValue(false)

    const response = await authorizeOrgAccessControl('user-1', 'org-1')

    expect(response?.status).toBe(403)
    await expect(response?.json()).resolves.toEqual({
      error: 'Access Control is an Enterprise feature',
    })
  })

  it('returns null when the user is an admin and the org is entitled', async () => {
    mockIsOrganizationAdminOrOwner.mockResolvedValue(true)
    mockIsOrganizationOnEnterprisePlan.mockResolvedValue(true)

    const response = await authorizeOrgAccessControl('user-1', 'org-1')

    expect(response).toBeNull()
  })
})

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
