/**
 * @vitest-environment node
 */
import { dbChainMock, dbChainMockFns, urlsMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetHighestPrioritySubscription,
  mockGetHighestPriorityPersonalSubscription,
  mockGetWorkspaceWithOwner,
  mockCheckEnterprisePlan,
  mockGetPlanTierCredits,
  mockHasUsableSubscriptionAccess,
} = vi.hoisted(() => ({
  mockGetHighestPrioritySubscription: vi.fn(),
  mockGetHighestPriorityPersonalSubscription: vi.fn(),
  mockGetWorkspaceWithOwner: vi.fn(),
  mockCheckEnterprisePlan: vi.fn(),
  mockGetPlanTierCredits: vi.fn(),
  mockHasUsableSubscriptionAccess: vi.fn(),
}))

vi.mock('@sim/db', () => dbChainMock)

vi.mock('@/lib/billing/core/access', () => ({
  getEffectiveBillingStatus: vi.fn(),
  isOrganizationBillingBlocked: vi.fn(),
}))

vi.mock('@/lib/billing/core/plan', () => ({
  getHighestPriorityPersonalSubscription: mockGetHighestPriorityPersonalSubscription,
  getHighestPrioritySubscription: mockGetHighestPrioritySubscription,
}))

vi.mock('@/lib/billing/plan-helpers', () => ({
  getPlanTierCredits: mockGetPlanTierCredits,
  isEnterprise: vi.fn().mockReturnValue(false),
  isPro: vi.fn(),
  isTeam: vi.fn(),
}))

vi.mock('@/lib/billing/subscriptions/utils', () => ({
  checkEnterprisePlan: mockCheckEnterprisePlan,
  checkProPlan: vi.fn(),
  checkTeamPlan: vi.fn(),
  ENTITLED_SUBSCRIPTION_STATUSES: ['active', 'trialing'],
  hasUsableSubscriptionAccess: mockHasUsableSubscriptionAccess,
  USABLE_SUBSCRIPTION_STATUSES: ['active', 'trialing'],
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getWorkspaceWithOwner: mockGetWorkspaceWithOwner,
}))

vi.mock('@/lib/core/config/env-flags', () => ({
  isAccessControlEnabled: false,
  isBillingEnabled: true,
  isHosted: true,
  isInboxEnabled: false,
  isSsoEnabled: false,
}))

vi.mock('@/lib/core/utils/urls', () => urlsMock)

import {
  getOrganizationIdForSubscriptionReference,
  hasPaidSubscription,
  hasWorkspaceLiveSyncAccess,
  isWorkspaceOnEnterprisePlan,
} from '@/lib/billing/core/subscription'

describe('hasPaidSubscription', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns true when an entitled subscription exists', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ id: 'sub-1' }])

    await expect(hasPaidSubscription('org-1')).resolves.toBe(true)
  })

  it('returns false when no entitled subscription exists', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([])

    await expect(hasPaidSubscription('org-1')).resolves.toBe(false)
  })

  it('fails closed by default when the lookup errors', async () => {
    dbChainMockFns.limit.mockRejectedValueOnce(new Error('db unavailable'))

    await expect(hasPaidSubscription('org-1')).resolves.toBe(true)
  })

  it('throws when requested so callers can retry instead of skipping cleanup', async () => {
    dbChainMockFns.limit.mockRejectedValueOnce(new Error('db unavailable'))

    await expect(hasPaidSubscription('org-1', { onError: 'throw' })).rejects.toThrow(
      'db unavailable'
    )
  })
})

describe('getOrganizationIdForSubscriptionReference', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns an organization id directly when the reference already points to one', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ id: 'org-1' }])

    await expect(getOrganizationIdForSubscriptionReference('org-1')).resolves.toBe('org-1')
  })

  it('falls back to the admin-owned organization when the reference is still user-scoped', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ organizationId: 'org-1', role: 'owner' }])

    await expect(getOrganizationIdForSubscriptionReference('user-1')).resolves.toBe('org-1')
  })
})

describe('isWorkspaceOnEnterprisePlan', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetWorkspaceWithOwner.mockResolvedValue({
      id: 'ws-1',
      billedAccountUserId: 'owner-1',
      organizationId: null,
    })
  })

  it('uses only the exact personal subscription for a personal workspace payer', async () => {
    mockGetHighestPriorityPersonalSubscription.mockResolvedValue({
      referenceId: 'owner-1',
      plan: 'enterprise',
    })
    mockGetHighestPrioritySubscription.mockResolvedValue({
      referenceId: 'unrelated-org',
      plan: 'enterprise',
    })
    mockCheckEnterprisePlan.mockReturnValue(true)

    await expect(isWorkspaceOnEnterprisePlan('ws-1')).resolves.toBe(true)
    expect(mockGetHighestPriorityPersonalSubscription).toHaveBeenCalledWith('owner-1')
    expect(mockGetHighestPrioritySubscription).not.toHaveBeenCalled()
  })
})

describe('hasWorkspaceLiveSyncAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetWorkspaceWithOwner.mockResolvedValue({
      id: 'workspace-host',
      billedAccountUserId: 'workspace-owner',
      organizationId: null,
    })
    mockHasUsableSubscriptionAccess.mockImplementation(
      (status: string | null, billingBlocked: boolean) => status === 'active' && !billingBlocked
    )
    dbChainMockFns.limit.mockResolvedValue([{ billingBlocked: false }])
  })

  it('allows live sync from the exact Max workspace payer', async () => {
    mockGetHighestPriorityPersonalSubscription.mockResolvedValue({
      referenceId: 'workspace-owner',
      plan: 'pro_25000',
      status: 'active',
    })
    mockGetHighestPrioritySubscription.mockResolvedValue({
      referenceId: 'paid-external-actor',
      plan: 'enterprise',
      status: 'active',
    })
    mockGetPlanTierCredits.mockReturnValue(25000)

    await expect(hasWorkspaceLiveSyncAccess('workspace-host')).resolves.toBe(true)
    expect(mockGetHighestPriorityPersonalSubscription).toHaveBeenCalledWith('workspace-owner')
    expect(mockGetHighestPrioritySubscription).not.toHaveBeenCalled()
  })

  it('denies a free workspace even when the actor has an unrelated paid plan', async () => {
    mockGetHighestPriorityPersonalSubscription.mockResolvedValue(null)
    mockGetHighestPrioritySubscription.mockResolvedValue({
      referenceId: 'paid-external-actor',
      plan: 'enterprise',
      status: 'active',
    })

    await expect(hasWorkspaceLiveSyncAccess('workspace-host')).resolves.toBe(false)
    expect(mockGetHighestPriorityPersonalSubscription).toHaveBeenCalledWith('workspace-owner')
    expect(mockGetHighestPrioritySubscription).not.toHaveBeenCalled()
  })
})
