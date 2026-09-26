import { dbChainMockFns, resetDbChainMock, resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { billingAccessMock } from '@sim/testing/mocks/billing-access.mock'
import { billingUsageMock, billingUsageMockFns } from '@sim/testing/mocks/billing-usage.mock'
import {
  billingUsageLogMock,
  billingUsageLogMockFns,
} from '@sim/testing/mocks/billing-usage-log.mock'
import {
  organizationMemberLimitsMock,
  organizationMemberLimitsMockFns,
} from '@sim/testing/mocks/organization-member-limits.mock'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockComputeBillingPeriodUsageWithWeeklyRefresh } = vi.hoisted(() => ({
  mockComputeBillingPeriodUsageWithWeeklyRefresh: vi.fn(),
}))

vi.mock('@/lib/billing/organizations/member-limits', () => organizationMemberLimitsMock)

vi.mock('@/lib/billing/core/access', () => billingAccessMock)

vi.mock('@/lib/billing/core/usage', () => billingUsageMock)

vi.mock('@/lib/billing/core/usage-log', () => billingUsageLogMock)

vi.mock('@/lib/billing/credits/weekly-refresh', () => ({
  computeBillingPeriodUsageWithWeeklyRefresh: mockComputeBillingPeriodUsageWithWeeklyRefresh,
}))

import {
  checkOrganizationMemberUsageLimit,
  checkServerSideUsageLimits,
  checkUsageStatus,
} from '@/lib/billing/calculations/usage-monitor'

const { mockGetOrgMemberUsageForBillingPeriod, mockGetOrgMemberUsageLimit } =
  organizationMemberLimitsMockFns
const mockGetBillingPeriodUsageCost = billingUsageLogMockFns.mockGetBillingPeriodUsageCost
const mockGetUserUsageLimit = billingUsageMockFns.mockGetUserUsageLimit

afterAll(() => {
  resetDbChainMock()
})

afterAll(resetEnvFlagsMock)

describe('checkUsageStatus', () => {
  beforeEach(() => {
    resetDbChainMock()
    setEnvFlags({ isHosted: true, isBillingEnabled: true })
    mockGetUserUsageLimit.mockResolvedValue(500)
    mockGetBillingPeriodUsageCost.mockResolvedValue(125)
    mockComputeBillingPeriodUsageWithWeeklyRefresh.mockResolvedValue({
      ledgerUsage: 125,
      refreshConsumed: 25,
    })
  })

  it('shares one pooled sum across admissions in an enterprise reporting window', async () => {
    const billingPeriod = {
      start: new Date('2026-01-01T00:00:00.000Z'),
      end: new Date('2027-01-01T00:00:00.000Z'),
      source: 'reporting' as const,
      anchorDate: '2026-01-01',
      interval: 'year' as const,
    }
    const subscription = {
      referenceId: 'org-reporting-shared',
      plan: 'enterprise',
      status: 'active',
      seats: 1,
      periodStart: billingPeriod.start,
      periodEnd: billingPeriod.end,
    }
    const billingContext = {
      billingEntity: { type: 'organization' as const, id: 'org-reporting-shared' },
      billingPeriod,
    }

    await checkUsageStatus('user-1', subscription, billingContext)
    await checkUsageStatus('user-2', subscription, billingContext)

    expect(mockGetBillingPeriodUsageCost).toHaveBeenCalledTimes(1)
  })

  it('sums a Stripe-period organization pool exactly on every admission', async () => {
    const billingPeriod = {
      start: new Date('2026-06-01T00:00:00.000Z'),
      end: new Date('2026-07-01T00:00:00.000Z'),
      source: 'stripe' as const,
    }
    const subscription = {
      referenceId: 'org-stripe',
      plan: 'team',
      status: 'active',
      seats: 1,
      periodStart: null,
      periodEnd: null,
    }
    const billingContext = {
      billingEntity: { type: 'organization' as const, id: 'org-stripe' },
      billingPeriod,
    }

    await checkUsageStatus('user-1', subscription, billingContext)
    await checkUsageStatus('user-1', subscription, billingContext)

    expect(mockGetBillingPeriodUsageCost).toHaveBeenCalledTimes(2)
  })

  it('preserves the paid weekly-refresh clamp for negative effective usage', async () => {
    const periodStart = new Date('2026-06-01T00:00:00.000Z')
    const periodEnd = new Date('2026-07-01T00:00:00.000Z')
    const subscription = {
      referenceId: 'user-1',
      plan: 'pro',
      status: 'active',
      seats: 1,
      periodStart,
      periodEnd,
    }
    mockComputeBillingPeriodUsageWithWeeklyRefresh.mockResolvedValueOnce({
      ledgerUsage: -1,
      refreshConsumed: 1,
    })

    await expect(checkUsageStatus('user-1', subscription)).resolves.toMatchObject({
      currentUsage: 0,
      scope: 'user',
    })
  })

  it('preserves negative ledger-only personal usage', async () => {
    const periodStart = new Date('2026-06-01T00:00:00.000Z')
    const periodEnd = new Date('2026-07-01T00:00:00.000Z')
    const subscription = {
      referenceId: 'user-1',
      plan: 'free',
      status: 'active',
      seats: 1,
      periodStart,
      periodEnd,
    }
    mockGetBillingPeriodUsageCost.mockResolvedValueOnce(-1)

    await expect(checkUsageStatus('user-1', subscription)).resolves.toMatchObject({
      currentUsage: -1,
      scope: 'user',
    })

    expect(mockComputeBillingPeriodUsageWithWeeklyRefresh).not.toHaveBeenCalled()
  })

  it('combines paid organization ledger usage with entity-scoped refresh — no roster read', async () => {
    const periodStart = new Date('2026-06-01T00:00:00.000Z')
    const periodEnd = new Date('2026-07-01T00:00:00.000Z')
    const subscription = {
      referenceId: 'org-1',
      plan: 'team',
      status: 'active',
      seats: 2,
      periodStart,
      periodEnd,
    }
    mockComputeBillingPeriodUsageWithWeeklyRefresh.mockResolvedValue({
      ledgerUsage: 100,
      refreshConsumed: 10,
    })

    await expect(checkUsageStatus('user-1', subscription)).resolves.toMatchObject({
      currentUsage: 90,
      scope: 'organization',
      organizationId: 'org-1',
    })

    // Refresh is scoped by the entity stamps alone, so departed members'
    // org-attributed rows participate identically to current members'.
    expect(mockComputeBillingPeriodUsageWithWeeklyRefresh).toHaveBeenCalledWith({
      billingEntity: { type: 'organization', id: 'org-1' },
      billingPeriod: expect.objectContaining({
        start: periodStart,
        end: periodEnd,
        source: 'stripe',
      }),
      refreshPeriodStart: periodStart,
      refreshPeriodEnd: periodEnd,
      weeklyRefreshDollars: expect.any(Number),
      seats: 2,
    })
    expect(mockGetBillingPeriodUsageCost).not.toHaveBeenCalled()
  })
})

describe('checkServerSideUsageLimits', () => {
  beforeEach(() => {
    resetDbChainMock()
    setEnvFlags({ isHosted: true, isBillingEnabled: true })
    mockGetBillingPeriodUsageCost.mockResolvedValue(125)
  })

  it('keeps blocked accounts blocked while reporting their real ledger usage', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ blocked: true, blockedReason: 'payment_failed' }])
    const subscription = {
      referenceId: 'user-1',
      plan: 'pro',
      status: 'active',
      seats: 1,
      periodStart: new Date('2026-06-01T00:00:00.000Z'),
      periodEnd: new Date('2026-07-01T00:00:00.000Z'),
    }

    const result = await checkServerSideUsageLimits('user-1', subscription)

    expect(result).toMatchObject({ isExceeded: true, currentUsage: 125, limit: 0 })
    expect(result.message).toBeTruthy()
    expect(mockGetBillingPeriodUsageCost).toHaveBeenCalledWith(
      { type: 'user', id: 'user-1' },
      expect.objectContaining({
        start: subscription.periodStart,
        end: subscription.periodEnd,
      })
    )
  })
})

describe('checkOrganizationMemberUsageLimit', () => {
  const billingPeriod = {
    start: new Date('2026-06-01T00:00:00.000Z'),
    end: new Date('2026-07-01T00:00:00.000Z'),
  }

  beforeEach(() => {
    resetDbChainMock()
    setEnvFlags({ isHosted: true, isBillingEnabled: true })
    mockGetOrgMemberUsageLimit.mockResolvedValue(2)
    mockGetOrgMemberUsageForBillingPeriod.mockResolvedValue(1)
  })

  it('no-ops when not hosted', async () => {
    setEnvFlags({ isHosted: false })
    const result = await checkOrganizationMemberUsageLimit('actor-1', 'org-1', billingPeriod)
    expect(result.isExceeded).toBe(false)
    expect(mockGetOrgMemberUsageLimit).not.toHaveBeenCalled()
  })

  it('no-ops without reading usage when the member has no cap set', async () => {
    mockGetOrgMemberUsageLimit.mockResolvedValue(null)
    const result = await checkOrganizationMemberUsageLimit('actor-1', 'org-1', billingPeriod)
    expect(result.isExceeded).toBe(false)
    expect(mockGetOrgMemberUsageForBillingPeriod).not.toHaveBeenCalled()
  })

  it('blocks when usage meets the cap (>=)', async () => {
    mockGetOrgMemberUsageForBillingPeriod.mockResolvedValue(2)
    const result = await checkOrganizationMemberUsageLimit('actor-1', 'org-1', billingPeriod)
    expect(result.isExceeded).toBe(true)
    expect(result.message).toBeTruthy()
  })

  it('blocks all usage when the cap is 0', async () => {
    mockGetOrgMemberUsageLimit.mockResolvedValue(0)
    mockGetOrgMemberUsageForBillingPeriod.mockResolvedValue(0)
    const result = await checkOrganizationMemberUsageLimit('actor-1', 'org-1', billingPeriod)
    expect(result.isExceeded).toBe(true)
  })

  it('fails open when an unexpected error occurs', async () => {
    mockGetOrgMemberUsageLimit.mockRejectedValue(new Error('db down'))
    const result = await checkOrganizationMemberUsageLimit('actor-1', 'org-1', billingPeriod)
    expect(result.isExceeded).toBe(false)
  })
})
