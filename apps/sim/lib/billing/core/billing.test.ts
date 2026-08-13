/**
 * @vitest-environment node
 */
import { dbChainMock, dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockComputeDailyRefreshConsumed,
  mockEnsureUserStatsExists,
  mockGetBillingPeriodUsageCost,
  mockGetBillingPeriodUsageCostWithSourceSubset,
  mockGetHighestPriorityPersonalSubscription,
  mockGetHighestPrioritySubscription,
  mockResolveBillingInterval,
} = vi.hoisted(() => ({
  mockComputeDailyRefreshConsumed: vi.fn(),
  mockEnsureUserStatsExists: vi.fn(),
  mockGetBillingPeriodUsageCost: vi.fn(),
  mockGetBillingPeriodUsageCostWithSourceSubset: vi.fn(),
  mockGetHighestPriorityPersonalSubscription: vi.fn(),
  mockGetHighestPrioritySubscription: vi.fn(),
  mockResolveBillingInterval: vi.fn(),
}))

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
  getBillingPeriodUsageCostWithSourceSubset: mockGetBillingPeriodUsageCostWithSourceSubset,
}))

vi.mock('@/lib/billing/credits/daily-refresh', () => ({
  computeDailyRefreshConsumed: mockComputeDailyRefreshConsumed,
  getOrgMemberRefreshBounds: vi.fn(),
}))

import {
  calculateSubscriptionOverage,
  calculateSubscriptionUsage,
  getPersonalBillingSummary,
} from '@/lib/billing/core/billing'

describe('getPersonalBillingSummary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockEnsureUserStatsExists.mockResolvedValue(undefined)
    mockResolveBillingInterval.mockReturnValue('year')
    mockComputeDailyRefreshConsumed.mockResolvedValue(3)
    mockGetBillingPeriodUsageCostWithSourceSubset.mockResolvedValue({ total: 2, subset: 1 })
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

describe('subscription usage calculation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockComputeDailyRefreshConsumed.mockResolvedValue(1.175)
    mockGetBillingPeriodUsageCost.mockResolvedValue(2.175)
  })

  it('returns gross and effective personal usage without changing overage math', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        currentPeriodCost: '29',
        proPeriodCostSnapshot: '0',
        proPeriodCostSnapshotAt: null,
      },
    ])

    const periodStart = new Date('2026-07-01T00:00:00.000Z')
    const periodEnd = new Date('2026-08-01T00:00:00.000Z')
    const result = await calculateSubscriptionUsage({
      id: 'personal-sub',
      plan: 'pro_6000',
      referenceId: 'user-1',
      periodStart,
      periodEnd,
    })

    expect(result).toEqual({
      totalUsage: 31.175,
      effectiveUsage: 30,
      dailyRefreshDeduction: 1.175,
      totalOverage: 0,
    })
    expect(mockGetBillingPeriodUsageCost).toHaveBeenCalledWith(
      { type: 'user', id: 'user-1' },
      { start: periodStart, end: periodEnd }
    )
  })

  it('keeps the enterprise overage fast path at zero', async () => {
    await expect(
      calculateSubscriptionOverage({
        id: 'enterprise-sub',
        plan: 'enterprise',
        referenceId: 'org-1',
      })
    ).resolves.toBe(0)

    expect(dbChainMockFns.select).not.toHaveBeenCalled()
  })

  it('preserves the existing personal overage result', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        currentPeriodCost: '39',
        proPeriodCostSnapshot: '0',
        proPeriodCostSnapshotAt: null,
      },
    ])

    await expect(
      calculateSubscriptionOverage({
        id: 'personal-sub',
        plan: 'pro_6000',
        referenceId: 'user-1',
        periodStart: new Date('2026-07-01T00:00:00.000Z'),
        periodEnd: new Date('2026-08-01T00:00:00.000Z'),
      })
    ).resolves.toBe(10)
  })
})
