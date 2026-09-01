/**
 * @vitest-environment node
 */
import { dbChainMock, dbChainMockFns, queueTableRows, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockComputeWeeklyRefreshConsumed,
  mockEnsureUserStatsExists,
  mockGetBillingPeriodUsageCost,
  mockGetBillingPeriodUsageCostWithSourceSubset,
  mockGetHighestPriorityPersonalSubscription,
  mockGetHighestPrioritySubscription,
  mockResolveBillingInterval,
} = vi.hoisted(() => ({
  mockComputeWeeklyRefreshConsumed: vi.fn(),
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

vi.mock('@/lib/billing/credits/weekly-refresh', () => ({
  computeWeeklyRefreshConsumed: mockComputeWeeklyRefreshConsumed,
}))

import { calculateSubscriptionOverage, getPersonalBillingSummary } from '@/lib/billing/core/billing'

describe('getPersonalBillingSummary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEnsureUserStatsExists.mockResolvedValue(undefined)
    mockResolveBillingInterval.mockReturnValue('year')
    mockComputeWeeklyRefreshConsumed.mockResolvedValue(1)
    mockGetBillingPeriodUsageCostWithSourceSubset.mockResolvedValue({ total: 4, subset: 1 })
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
        currentUsageLimit: '30',
        lastPeriodCost: '6',
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
    expect(mockComputeWeeklyRefreshConsumed).toHaveBeenCalledWith(
      expect.objectContaining({
        periodEnd: new Date('2026-08-01T00:00:00.000Z'),
        billingEntity: { type: 'user', id: 'viewer-a' },
      }),
      dbChainMock.db
    )
  })
})

describe('calculateSubscriptionOverage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockComputeWeeklyRefreshConsumed.mockResolvedValue(0)
  })

  it('bills the pooled org ledger with entity-scoped refresh — no roster read', async () => {
    queueTableRows(schemaMock.organization, [{ id: 'org-1' }]) // isSubscriptionOrgScoped
    // Pooled ledger sum includes departed members' org-stamped rows.
    mockGetBillingPeriodUsageCost.mockResolvedValue(160)

    const overage = await calculateSubscriptionOverage({
      id: 'sub-1',
      plan: 'team',
      referenceId: 'org-1',
      seats: 2,
      periodStart: new Date('2026-07-01T00:00:00.000Z'),
      periodEnd: new Date('2026-08-01T00:00:00.000Z'),
    })

    expect(mockGetBillingPeriodUsageCost).toHaveBeenCalledWith(
      { type: 'organization', id: 'org-1' },
      {
        start: new Date('2026-07-01T00:00:00.000Z'),
        end: new Date('2026-08-01T00:00:00.000Z'),
      }
    )
    // Refresh is scoped by the same entity stamps as the ledger sum — no
    // actor list, so departed members' rows participate identically.
    expect(mockComputeWeeklyRefreshConsumed).toHaveBeenCalledWith({
      billingEntity: { type: 'organization', id: 'org-1' },
      periodStart: new Date('2026-07-01T00:00:00.000Z'),
      periodEnd: new Date('2026-08-01T00:00:00.000Z'),
      weeklyRefreshDollars: 10,
      seats: 2,
    })
    expect(overage).toBe(80)
  })
})
