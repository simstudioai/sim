import {
  billingSubscriptionUtilsMock,
  billingSubscriptionUtilsMockFns,
} from '@sim/testing/mocks/billing-subscription-utils.mock'
import { billingUsageMock, billingUsageMockFns } from '@sim/testing/mocks/billing-usage.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  events: [] as string[],
  getCreditBalanceForEntity: vi.fn(),
}))

vi.mock('@/lib/billing/core/usage', () => billingUsageMock)

vi.mock('@/lib/billing/credits/balance', () => ({
  getCreditBalanceForEntity: hoisted.getCreditBalanceForEntity,
}))

vi.mock('@/lib/billing/subscriptions/utils', () => billingSubscriptionUtilsMock)

import { getAccountBillingSnapshot } from '@/lib/billing/core/account-billing-snapshot'

const mocks = {
  ...hoisted,
  getResolvedUserUsageData: billingUsageMockFns.mockGetResolvedUserUsageData,
  isOrgScopedSubscription: billingSubscriptionUtilsMockFns.mockIsOrgScopedSubscription,
}

const usage = {
  currentUsage: 18.5,
  limit: 40,
  percentUsed: 46.25,
  isWarning: false,
  isExceeded: false,
  billingPeriodStart: new Date('2026-08-01T00:00:00Z'),
  billingPeriodEnd: new Date('2026-09-01T00:00:00Z'),
  lastPeriodCost: 31,
}

describe('getAccountBillingSnapshot', () => {
  beforeEach(() => {
    mocks.events.length = 0
  })

  it('preserves personal scope and clamps negative remaining usage to zero', async () => {
    mocks.getResolvedUserUsageData.mockResolvedValue({
      usage: { ...usage, currentUsage: 45, isExceeded: true },
      subscription: { plan: 'pro', referenceId: 'user-1' },
      personalCreditBalance: 0,
    })
    mocks.isOrgScopedSubscription.mockReturnValue(false)
    mocks.getCreditBalanceForEntity.mockResolvedValue(0)

    await expect(getAccountBillingSnapshot('user-1')).resolves.toMatchObject({
      plan: 'pro',
      billingScope: 'user',
      organizationId: null,
      usage: { remaining: 0, isExceeded: true },
      credits: { balance: 0, scope: 'user' },
    })
    expect(mocks.getCreditBalanceForEntity).not.toHaveBeenCalled()
  })
})
