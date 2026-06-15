/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockIsOrganizationAdminOrOwner, mockIsOrganizationOnEnterprisePlan, mockConflictRows } =
  vi.hoisted(() => ({
    mockIsOrganizationAdminOrOwner: vi.fn<() => Promise<boolean>>(),
    mockIsOrganizationOnEnterprisePlan: vi.fn<() => Promise<boolean>>(),
    mockConflictRows: {
      value: [] as Array<{
        userId: string
        userName: string | null
        userEmail: string | null
        otherGroupId: string
        otherGroupName: string
        otherAppliesToAll: boolean
        otherWorkspaceId: string | null
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
      // findScopeConflicts awaits the builder directly after `where`.
      chain.where = vi.fn(() => Promise.resolve(mockConflictRows.value))
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
}))

import { authorizeOrgAccessControl, findScopeConflicts } from './utils'

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
    candidateUserIds: ['user-1'],
  }

  /** Build a conflict-query row with sensible defaults. */
  const row = (overrides: { otherAppliesToAll: boolean; otherWorkspaceId: string | null }) => ({
    userId: 'user-1',
    userName: 'User One',
    userEmail: 'user-1@example.com',
    otherGroupId: 'group-2',
    otherGroupName: 'Marketing',
    ...overrides,
  })

  it('returns no conflicts when there are no candidate users', async () => {
    mockConflictRows.value = [row({ otherAppliesToAll: true, otherWorkspaceId: null })]

    const conflicts = await findScopeConflicts({
      ...baseParams,
      appliesToAllWorkspaces: true,
      workspaceIds: [],
      candidateUserIds: [],
    })

    expect(conflicts).toEqual([])
  })

  it('flags an all-workspaces target when the user is in another all-workspaces group', async () => {
    mockConflictRows.value = [row({ otherAppliesToAll: true, otherWorkspaceId: null })]

    const conflicts = await findScopeConflicts({
      ...baseParams,
      appliesToAllWorkspaces: true,
      workspaceIds: [],
    })

    expect(conflicts.map((c) => c.userId)).toEqual(['user-1'])
    expect(conflicts[0].conflictingGroupName).toBe('Marketing')
  })

  it('allows an all-workspaces target when the user is only in a specific group', async () => {
    mockConflictRows.value = [row({ otherAppliesToAll: false, otherWorkspaceId: 'ws-1' })]

    const conflicts = await findScopeConflicts({
      ...baseParams,
      appliesToAllWorkspaces: true,
      workspaceIds: [],
    })

    expect(conflicts).toEqual([])
  })

  it('flags a specific target that shares a workspace with another specific group', async () => {
    mockConflictRows.value = [row({ otherAppliesToAll: false, otherWorkspaceId: 'ws-1' })]

    const conflicts = await findScopeConflicts({
      ...baseParams,
      appliesToAllWorkspaces: false,
      workspaceIds: ['ws-1', 'ws-2'],
    })

    expect(conflicts.map((c) => c.userId)).toEqual(['user-1'])
    expect(conflicts[0].conflictingGroupName).toBe('Marketing')
  })

  it('allows a specific target whose workspaces are disjoint from the user other specific group', async () => {
    mockConflictRows.value = [row({ otherAppliesToAll: false, otherWorkspaceId: 'ws-3' })]

    const conflicts = await findScopeConflicts({
      ...baseParams,
      appliesToAllWorkspaces: false,
      workspaceIds: ['ws-1', 'ws-2'],
    })

    expect(conflicts).toEqual([])
  })

  it('allows a specific target when the user is only in an all-workspaces group', async () => {
    mockConflictRows.value = [row({ otherAppliesToAll: true, otherWorkspaceId: null })]

    const conflicts = await findScopeConflicts({
      ...baseParams,
      appliesToAllWorkspaces: false,
      workspaceIds: ['ws-1'],
    })

    expect(conflicts).toEqual([])
  })
})
