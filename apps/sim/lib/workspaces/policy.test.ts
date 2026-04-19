/**
 * @vitest-environment node
 */
import { schemaMock } from '@sim/testing'
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

vi.mock('@sim/db/schema', () => schemaMock)

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

import {
  getWorkspaceCreationPolicy,
  getWorkspaceInvitePolicy,
  WORKSPACE_MODE,
} from '@/lib/workspaces/policy'
import { UPGRADE_TO_INVITE_REASON } from '@/lib/workspaces/policy-constants'

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

  it('allows max users to create up to ten personal workspaces', async () => {
    mockGetHighestPrioritySubscription.mockResolvedValueOnce({
      id: 'sub-1',
      plan: 'pro_25000',
      status: 'active',
    })
    mockDbResults.value = [[{ value: 5 }]]

    const result = await getWorkspaceCreationPolicy({ userId: 'user-1' })

    expect(result.canCreate).toBe(true)
    expect(result.workspaceMode).toBe(WORKSPACE_MODE.PERSONAL)
    expect(result.maxWorkspaces).toBe(10)
    expect(result.currentWorkspaceCount).toBe(5)
  })

  it('blocks max users once they already own ten personal workspaces', async () => {
    mockGetHighestPrioritySubscription.mockResolvedValueOnce({
      id: 'sub-1',
      plan: 'pro_25000',
      status: 'active',
    })
    mockDbResults.value = [[{ value: 10 }]]

    const result = await getWorkspaceCreationPolicy({ userId: 'user-1' })

    expect(result.canCreate).toBe(false)
    expect(result.maxWorkspaces).toBe(10)
    expect(result.currentWorkspaceCount).toBe(10)
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

describe('getWorkspaceInvitePolicy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFeatureFlags.isBillingEnabled = true
    mockGetHighestPrioritySubscription.mockResolvedValue(null)
  })

  const baseState = {
    workspaceMode: WORKSPACE_MODE.PERSONAL,
    organizationId: null,
    billedAccountUserId: 'owner-1',
    ownerId: 'owner-1',
  } as const

  it('allows invites unconditionally when billing is disabled', async () => {
    mockFeatureFlags.isBillingEnabled = false

    const result = await getWorkspaceInvitePolicy(baseState)

    expect(result.allowed).toBe(true)
    expect(result.upgradeRequired).toBe(false)
    expect(mockGetHighestPrioritySubscription).not.toHaveBeenCalled()
  })

  it('blocks personal workspaces with an upgrade prompt', async () => {
    const result = await getWorkspaceInvitePolicy(baseState)

    expect(result.allowed).toBe(false)
    expect(result.upgradeRequired).toBe(true)
    expect(result.reason).toBe(UPGRADE_TO_INVITE_REASON)
  })

  it('allows org workspaces and flags them as seat-gated', async () => {
    const result = await getWorkspaceInvitePolicy({
      ...baseState,
      workspaceMode: WORKSPACE_MODE.ORGANIZATION,
      organizationId: 'org-1',
    })

    expect(result.allowed).toBe(true)
    expect(result.requiresSeat).toBe(true)
    expect(result.organizationId).toBe('org-1')
  })

  it('blocks org workspaces without an organization id', async () => {
    const result = await getWorkspaceInvitePolicy({
      ...baseState,
      workspaceMode: WORKSPACE_MODE.ORGANIZATION,
    })

    expect(result.allowed).toBe(false)
    expect(result.upgradeRequired).toBe(true)
  })

  it('allows grandfathered workspaces when the billed user has a team plan', async () => {
    mockGetHighestPrioritySubscription.mockResolvedValueOnce({
      id: 'sub-1',
      plan: 'team_6000',
      status: 'active',
    })

    const result = await getWorkspaceInvitePolicy({
      ...baseState,
      workspaceMode: WORKSPACE_MODE.GRANDFATHERED_SHARED,
    })

    expect(result.allowed).toBe(true)
    expect(result.upgradeRequired).toBe(false)
    expect(mockGetHighestPrioritySubscription).toHaveBeenCalledWith('owner-1')
  })

  it('allows grandfathered workspaces when the billed user has an enterprise plan', async () => {
    mockGetHighestPrioritySubscription.mockResolvedValueOnce({
      id: 'sub-1',
      plan: 'enterprise',
      status: 'active',
    })

    const result = await getWorkspaceInvitePolicy({
      ...baseState,
      workspaceMode: WORKSPACE_MODE.GRANDFATHERED_SHARED,
    })

    expect(result.allowed).toBe(true)
  })

  it('blocks grandfathered workspaces when the billed user is on a free plan', async () => {
    mockGetHighestPrioritySubscription.mockResolvedValueOnce(null)

    const result = await getWorkspaceInvitePolicy({
      ...baseState,
      workspaceMode: WORKSPACE_MODE.GRANDFATHERED_SHARED,
    })

    expect(result.allowed).toBe(false)
    expect(result.upgradeRequired).toBe(true)
    expect(result.reason).toBe(UPGRADE_TO_INVITE_REASON)
  })

  it('blocks grandfathered workspaces when the billed user is on a pro plan', async () => {
    mockGetHighestPrioritySubscription.mockResolvedValueOnce({
      id: 'sub-1',
      plan: 'pro_6000',
      status: 'active',
    })

    const result = await getWorkspaceInvitePolicy({
      ...baseState,
      workspaceMode: WORKSPACE_MODE.GRANDFATHERED_SHARED,
    })

    expect(result.allowed).toBe(false)
    expect(result.upgradeRequired).toBe(true)
  })
})
