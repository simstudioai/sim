/** @vitest-environment node */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getOrganizationSubscription, getBillingPeriodUsageCostByUser } = vi.hoisted(() => ({
  getOrganizationSubscription: vi.fn(),
  getBillingPeriodUsageCostByUser: vi.fn(),
}))

vi.mock('@/lib/billing/core/billing', () => ({
  getOrganizationSubscription,
  getPlanPricing: vi.fn(),
}))
vi.mock('@/lib/billing/core/usage-log', () => ({
  getBillingPeriodUsageCost: vi.fn(),
  getBillingPeriodUsageCostByUser,
}))

import { getOrganizationMemberUsageSnapshot } from '@/lib/billing/core/organization'

describe('getOrganizationMemberUsageSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-20T12:00:00.000Z'))
    getBillingPeriodUsageCostByUser.mockResolvedValue(new Map([['user-1', 12.5]]))
  })

  afterEach(() => vi.useRealTimers())

  it('uses the Enterprise reporting window for anchored organizations', async () => {
    getOrganizationSubscription.mockResolvedValue({
      plan: 'enterprise',
      billingInterval: 'year',
      metadata: { reportingPeriodAnchorDate: '2026-01-01' },
      periodStart: new Date('2026-08-01T00:00:00.000Z'),
      periodEnd: new Date('2026-09-01T00:00:00.000Z'),
    })

    const snapshot = await getOrganizationMemberUsageSnapshot('org-1', {
      userIds: ['user-1'],
    })

    expect(snapshot.billingPeriod).toMatchObject({
      source: 'reporting',
      start: new Date('2026-01-01T00:00:00.000Z'),
      end: new Date('2027-01-01T00:00:00.000Z'),
    })
    expect(getBillingPeriodUsageCostByUser).toHaveBeenCalledWith(
      { type: 'organization', id: 'org-1' },
      expect.objectContaining({ source: 'reporting' }),
      undefined,
      expect.anything(),
      ['user-1']
    )
  })

  it('uses Stripe dates without custom reporting metadata', async () => {
    const periodStart = new Date('2026-08-01T00:00:00.000Z')
    const periodEnd = new Date('2026-09-01T00:00:00.000Z')
    getOrganizationSubscription.mockResolvedValue({
      plan: 'enterprise',
      billingInterval: 'month',
      metadata: {},
      periodStart,
      periodEnd,
    })

    const snapshot = await getOrganizationMemberUsageSnapshot('org-1')

    expect(snapshot.billingPeriod).toEqual({
      source: 'stripe',
      start: periodStart,
      end: periodEnd,
      anchorDate: null,
      interval: 'month',
    })
    expect(snapshot.usageByUser).toEqual(new Map([['user-1', 12.5]]))
  })
})
