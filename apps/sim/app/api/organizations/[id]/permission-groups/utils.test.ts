/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockIsOrganizationAdminOrOwner,
  mockIsOrganizationOnEnterprisePlan,
  mockConflictRows,
  mockAllMembersRows,
} = vi.hoisted(() => ({
  mockIsOrganizationAdminOrOwner: vi.fn<() => Promise<boolean>>(),
  mockIsOrganizationOnEnterprisePlan: vi.fn<() => Promise<boolean>>(),
  mockConflictRows: {
    value: [] as Array<{
      userId: string
      userName: string | null
      userEmail: string | null
      otherGroupId: string
      otherGroupName: string
    }>,
  },
  mockAllMembersRows: {
    value: [] as Array<{
      conflictingGroupId: string
      conflictingGroupName: string
      workspaceName: string
    }>,
  },
}))

vi.mock('@/lib/billing', () => ({
  isOrganizationOnEnterprisePlan: mockIsOrganizationOnEnterprisePlan,
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  isOrganizationAdminOrOwner: mockIsOrganizationAdminOrOwner,
}))

vi.mock('@sim/db', () => ({
  db: {
    select: vi.fn(() => {
      const chain: Record<string, unknown> = {}
      chain.from = vi.fn(() => chain)
      chain.innerJoin = vi.fn(() => chain)
      chain.leftJoin = vi.fn(() => chain)
      chain.where = vi.fn(() => chain)
      chain.orderBy = vi.fn(() => chain)
      // findAllMembersWorkspaceConflict ends in `.limit(1)`; findScopeConflicts
      // awaits the builder directly after `.where()`.
      chain.limit = vi.fn(() => Promise.resolve(mockAllMembersRows.value))
      chain.then = (onFulfilled: (rows: unknown) => unknown) =>
        Promise.resolve(mockConflictRows.value).then(onFulfilled)
      return chain
    }),
  },
}))

vi.mock('@sim/db/schema', () => ({
  permissionGroup: {},
  permissionGroupMember: {},
  permissionGroupWorkspace: {},
  user: {},
  workspace: {},
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn(),
  asc: vi.fn(),
  eq: vi.fn(),
  inArray: vi.fn(),
  ne: vi.fn(),
  sql: vi.fn(),
}))

import {
  authorizeOrgAccessControl,
  findAllMembersWorkspaceConflict,
  findScopeConflicts,
} from './utils'

describe('authorizeOrgAccessControl', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
    mockConflictRows.value = []
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
    mockConflictRows.value = [conflictRow('user-1')]

    const conflicts = await findScopeConflicts({ ...baseParams, candidateUserIds: [] })

    expect(conflicts).toEqual([])
  })

  it('returns no conflicts when there are no target workspaces', async () => {
    mockConflictRows.value = [conflictRow('user-1')]

    const conflicts = await findScopeConflicts({ ...baseParams, workspaceIds: [] })

    expect(conflicts).toEqual([])
  })

  it('flags a candidate already in another group that shares a workspace', async () => {
    mockConflictRows.value = [conflictRow('user-1')]

    const conflicts = await findScopeConflicts(baseParams)

    expect(conflicts.map((c) => c.userId)).toEqual(['user-1'])
    expect(conflicts[0].conflictingGroupName).toBe('Marketing')
  })

  it('returns at most one conflict per user', async () => {
    mockConflictRows.value = [conflictRow('user-1', 'Marketing'), conflictRow('user-1', 'Sales')]

    const conflicts = await findScopeConflicts(baseParams)

    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].conflictingGroupName).toBe('Marketing')
  })

  it('returns no conflicts when the query finds no overlapping memberships', async () => {
    mockConflictRows.value = []

    const conflicts = await findScopeConflicts(baseParams)

    expect(conflicts).toEqual([])
  })
})

describe('findAllMembersWorkspaceConflict', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAllMembersRows.value = []
  })

  const baseParams = {
    organizationId: 'org-1',
    excludeGroupId: 'group-1',
    workspaceIds: ['ws-1', 'ws-2'],
  }

  it('returns null when there are no target workspaces', async () => {
    mockAllMembersRows.value = [
      { conflictingGroupId: 'group-2', conflictingGroupName: 'Marketing', workspaceName: 'Acme' },
    ]

    const conflict = await findAllMembersWorkspaceConflict({ ...baseParams, workspaceIds: [] })

    expect(conflict).toBeNull()
  })

  it('returns the conflicting all-members group sharing a workspace', async () => {
    mockAllMembersRows.value = [
      { conflictingGroupId: 'group-2', conflictingGroupName: 'Marketing', workspaceName: 'Acme' },
    ]

    const conflict = await findAllMembersWorkspaceConflict(baseParams)

    expect(conflict).toEqual({
      conflictingGroupId: 'group-2',
      conflictingGroupName: 'Marketing',
      workspaceName: 'Acme',
    })
  })

  it('returns null when no other all-members group targets the workspaces', async () => {
    mockAllMembersRows.value = []

    const conflict = await findAllMembersWorkspaceConflict(baseParams)

    expect(conflict).toBeNull()
  })
})
