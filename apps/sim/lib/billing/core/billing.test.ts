/**
 * @vitest-environment node
 */
import { dbChainMock, dbChainMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockComputeDailyRefreshConsumed,
  mockEnsureUserStatsExists,
  mockGetBillingPeriodUsageCost,
  mockGetHighestPriorityPersonalSubscription,
  mockGetHighestPrioritySubscription,
  mockResolveBillingInterval,
} = vi.hoisted(() => ({
  mockComputeDailyRefreshConsumed: vi.fn(),
  mockEnsureUserStatsExists: vi.fn(),
  mockGetBillingPeriodUsageCost: vi.fn(),
  mockGetHighestPriorityPersonalSubscription: vi.fn(),
  mockGetHighestPrioritySubscription: vi.fn(),
  mockResolveBillingInterval: vi.fn(),
}))

vi.mock('@sim/db', () => dbChainMock)

vi.mock('@/lib/billing/core/subscription', () => ({
  getHighestPriorityPersonalSubscription: mockGetHighestPriorityPersonalSubscription,
  getHighestPrioritySubscription: mockGetHighestPrioritySubscription,
  resolveBillingInterval: mockResolveBillingInterval,
}))

vi.mock('@/lib/billing/core/usage', () => ({
  ensureUserStatsExists: mockEnsureUserStatsExists,
  getOrgUsageLimit: vi.fn(),
  getUserUsageData: vi.fn(),
}))

vi.mock('@/lib/billing/core/usage-log', () => ({
  COPILOT_USAGE_SOURCES: ['copilot'],
  getBillingPeriodUsageCost: mockGetBillingPeriodUsageCost,
}))

vi.mock('@/lib/billing/credits/daily-refresh', () => ({
  computeDailyRefreshConsumed: mockComputeDailyRefreshConsumed,
  getOrgMemberRefreshBounds: vi.fn(),
}))

import { getPersonalBillingSummary } from '@/lib/billing/core/billing'

describe('getPersonalBillingSummary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEnsureUserStatsExists.mockResolvedValue(undefined)
    mockResolveBillingInterval.mockReturnValue('year')
    mockComputeDailyRefreshConsumed.mockResolvedValue(3)
    mockGetBillingPeriodUsageCost.mockResolvedValueOnce(2).mockResolvedValueOnce(1)
    mockGetHighestPriorityPersonalSubscription.mockResolvedValue({
      id: 'personal-sub',
      referenceId: 'viewer-a',
      plan: 'pro_6000',
      status: 'active',
      periodStart: new Date('2026-07-01T00:00:00.000Z'),
      periodEnd: new Date('2026-08-01T00:00:00.000Z'),
      seats: null,
      metadata: { billingInterval: 'year' },
      stripeSubscriptionId: 'stripe-personal',
      cancelAtPeriodEnd: true,
    })
    mockGetHighestPrioritySubscription.mockResolvedValue({
      id: 'unrelated-org-sub',
      referenceId: 'org-b',
      plan: 'team_25000',
      status: 'active',
    })
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        currentPeriodCost: '10',
        currentUsageLimit: '30',
        lastPeriodCost: '6',
        proPeriodCostSnapshot: '4',
        proPeriodCostSnapshotAt: new Date('2026-07-10T00:00:00.000Z'),
        currentPeriodCopilotCost: '5',
        lastPeriodCopilotCost: '2',
        creditBalance: '7',
        billingBlocked: true,
        billingBlockedReason: 'payment_failed',
      },
    ])
  })

  it('keeps subscription, usage, credits, and blocking personal across multiple orgs', async () => {
    const summary = await getPersonalBillingSummary('viewer-a')

    expect(mockGetHighestPriorityPersonalSubscription).toHaveBeenCalledWith('viewer-a', {
      executor: dbChainMock.db,
    })
    expect(mockGetHighestPrioritySubscription).not.toHaveBeenCalled()
    expect(summary).toMatchObject({
      type: 'individual',
      plan: 'pro_6000',
      currentUsage: 3,
      usageLimit: 30,
      creditBalance: 7,
      billingInterval: 'year',
      isOrgScoped: false,
      organizationId: null,
      billingBlocked: true,
      billingBlockedReason: 'payment_failed',
      blockedByOrgOwner: false,
    })
    expect(summary.usage).toMatchObject({
      current: 3,
      limit: 30,
      copilotCost: 1,
      lastPeriodCost: 6,
      lastPeriodCopilotCost: 2,
    })
    expect(mockComputeDailyRefreshConsumed).toHaveBeenCalledWith(
      expect.objectContaining({
        periodEnd: new Date('2026-07-10T00:00:00.000Z'),
        billingEntity: { type: 'user', id: 'viewer-a' },
      }),
      dbChainMock.db
    )
  })
})
