/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetUserOrganization,
  mockGetOrganizationSubscription,
  mockGetHighestPrioritySubscription,
  mockDbResults,
  mockFeatureFlags,
} = vi.hoisted(() => {
  const mockGetUserOrganization = vi.fn()
  const mockGetOrganizationSubscription = vi.fn()
  const mockGetHighestPrioritySubscription = vi.fn()
  const mockDbResults: { value: any[] } = { value: [] }
  const mockFeatureFlags = { isBillingEnabled: true }

  return {
    mockGetUserOrganization,
    mockGetOrganizationSubscription,
    mockGetHighestPrioritySubscription,
    mockDbResults,
    mockFeatureFlags,
  }
})

vi.mock('@sim/db', () => ({
  db: {
    select: vi.fn().mockImplementation(() => {
      const chain: any = {}
      chain.from = vi.fn().mockReturnValue(chain)
      chain.where = vi.fn().mockReturnValue(chain)
      chain.limit = vi
        .fn()
        .mockImplementation(() => Promise.resolve(mockDbResults.value.shift() || []))
      chain.then = vi.fn().mockImplementation((callback: (rows: any[]) => unknown) => {
        const result = mockDbResults.value.shift() || []
        return Promise.resolve(callback ? callback(result) : result)
      })
      return chain
    }),
  },
}))

vi.mock('@sim/db/schema', () => ({
  member: {
    role: 'role',
    userId: 'user_id',
    organizationId: 'organization_id',
  },
  workspace: {
    ownerId: 'owner_id',
    organizationId: 'organization_id',
    workspaceMode: 'workspace_mode',
  },
}))

vi.mock('@/lib/billing/organizations/membership', () => ({
  getUserOrganization: mockGetUserOrganization,
}))

vi.mock('@/lib/billing/core/billing', () => ({
  getOrganizationSubscription: mockGetOrganizationSubscription,
}))

vi.mock('@/lib/billing/core/plan', () => ({
  getHighestPrioritySubscription: mockGetHighestPrioritySubscription,
}))

vi.mock('@/lib/core/config/feature-flags', () => ({
  get isBillingEnabled() {
    return mockFeatureFlags.isBillingEnabled
  },
}))

vi.mock('@sim/logger', () => ({
  createLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => ({ type: 'and', conditions })),
  count: vi.fn(() => ({ type: 'count' })),
  eq: vi.fn((field: unknown, value: unknown) => ({ type: 'eq', field, value })),
  isNull: vi.fn((field: unknown) => ({ type: 'isNull', field })),
}))

import { getWorkspaceCreationPolicy, WORKSPACE_MODE } from '@/lib/workspaces/policy'

describe('getWorkspaceCreationPolicy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDbResults.value = []
    mockFeatureFlags.isBillingEnabled = true
    mockGetUserOrganization.mockResolvedValue(null)
    mockGetOrganizationSubscription.mockResolvedValue(null)
    mockGetHighestPrioritySubscription.mockResolvedValue(null)
  })

  it('blocks free users once they already own one non-organization workspace', async () => {
    mockDbResults.value = [[{ value: 1 }]]

    const result = await getWorkspaceCreationPolicy({ userId: 'user-1' })

    expect(result.canCreate).toBe(false)
    expect(result.workspaceMode).toBe(WORKSPACE_MODE.PERSONAL)
    expect(result.maxWorkspaces).toBe(1)
    expect(result.currentWorkspaceCount).toBe(1)
  })

  it('allows pro users to create up to three personal workspaces', async () => {
    mockGetHighestPrioritySubscription.mockResolvedValueOnce({
      id: 'sub-1',
      plan: 'pro_6000',
      status: 'active',
    })
    mockDbResults.value = [[{ value: 2 }]]

    const result = await getWorkspaceCreationPolicy({ userId: 'user-1' })

    expect(result.canCreate).toBe(true)
    expect(result.workspaceMode).toBe(WORKSPACE_MODE.PERSONAL)
    expect(result.maxWorkspaces).toBe(3)
    expect(result.currentWorkspaceCount).toBe(2)
  })

  it('allows unlimited personal workspaces when billing is disabled', async () => {
    mockFeatureFlags.isBillingEnabled = false
    mockDbResults.value = [[{ value: 9 }]]

    const result = await getWorkspaceCreationPolicy({ userId: 'user-1' })

    expect(result.canCreate).toBe(true)
    expect(result.workspaceMode).toBe(WORKSPACE_MODE.PERSONAL)
    expect(result.maxWorkspaces).toBeNull()
    expect(result.currentWorkspaceCount).toBe(9)
    expect(mockGetHighestPrioritySubscription).not.toHaveBeenCalled()
  })

  it('allows org admins on a team plan to create organization workspaces', async () => {
    mockGetUserOrganization.mockResolvedValueOnce({
      organizationId: 'org-1',
      role: 'admin',
      memberId: 'member-1',
    })
    mockGetOrganizationSubscription.mockResolvedValueOnce({
      id: 'sub-1',
      plan: 'team_6000',
      status: 'active',
    })
    mockDbResults.value = [[{ userId: 'owner-1' }]]

    const result = await getWorkspaceCreationPolicy({
      userId: 'user-1',
      activeOrganizationId: 'org-1',
    })

    expect(result.canCreate).toBe(true)
    expect(result.workspaceMode).toBe(WORKSPACE_MODE.ORGANIZATION)
    expect(result.organizationId).toBe('org-1')
    expect(result.billedAccountUserId).toBe('owner-1')
  })

  it('allows org admins to create organization workspaces when billing is disabled', async () => {
    mockFeatureFlags.isBillingEnabled = false
    mockGetUserOrganization.mockResolvedValueOnce({
      organizationId: 'org-1',
      role: 'admin',
      memberId: 'member-1',
    })
    mockDbResults.value = [[{ userId: 'owner-1' }]]

    const result = await getWorkspaceCreationPolicy({
      userId: 'user-1',
      activeOrganizationId: 'org-1',
    })

    expect(result.canCreate).toBe(true)
    expect(result.workspaceMode).toBe(WORKSPACE_MODE.ORGANIZATION)
    expect(result.organizationId).toBe('org-1')
    expect(result.billedAccountUserId).toBe('owner-1')
    expect(mockGetOrganizationSubscription).not.toHaveBeenCalled()
  })

  it('blocks non-admin org members from creating organization workspaces', async () => {
    mockGetUserOrganization.mockResolvedValueOnce({
      organizationId: 'org-1',
      role: 'member',
      memberId: 'member-1',
    })
    mockGetOrganizationSubscription.mockResolvedValueOnce({
      id: 'sub-1',
      plan: 'enterprise',
      status: 'active',
    })
    mockDbResults.value = [[{ userId: 'owner-1' }]]

    const result = await getWorkspaceCreationPolicy({
      userId: 'user-1',
      activeOrganizationId: 'org-1',
    })

    expect(result.canCreate).toBe(false)
    expect(result.workspaceMode).toBe(WORKSPACE_MODE.ORGANIZATION)
    expect(result.reason).toContain('owners and admins')
  })
})
