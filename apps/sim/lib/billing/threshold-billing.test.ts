/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  selectLimitMock,
  dbMock,
  getEffectiveBillingStatusMock,
  isOrganizationBillingBlockedMock,
  createOverageBillingClaimMock,
} = vi.hoisted(() => ({
  selectLimitMock: vi.fn(),
  dbMock: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => selectLimitMock()),
        })),
      })),
    })),
  },
  getEffectiveBillingStatusMock: vi.fn(),
  isOrganizationBillingBlockedMock: vi.fn(),
  createOverageBillingClaimMock: vi.fn(),
}))

vi.mock('@sim/db', () => ({ db: dbMock }))
vi.mock('@sim/db/schema', () => ({
  subscription: {
    id: 'subscription.id',
    referenceId: 'subscription.reference_id',
    status: 'subscription.status',
    plan: 'subscription.plan',
    stripeSubscriptionId: 'subscription.stripe_subscription_id',
    stripeCustomerId: 'subscription.stripe_customer_id',
    periodStart: 'subscription.period_start',
    periodEnd: 'subscription.period_end',
  },
  userStats: {
    userId: 'user_stats.user_id',
    billingBlocked: 'user_stats.billing_blocked',
  },
}))
vi.mock('@sim/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

vi.mock('@/lib/billing/constants', () => ({
  DEFAULT_OVERAGE_THRESHOLD: 10,
}))

vi.mock('@/lib/billing/core/access', () => ({
  getEffectiveBillingStatus: getEffectiveBillingStatusMock,
  isOrganizationBillingBlocked: isOrganizationBillingBlockedMock,
}))

vi.mock('@/lib/billing/ledger/usage-ledger', () => ({
  createOverageBillingClaim: createOverageBillingClaimMock,
}))

vi.mock('@/lib/billing/plan-helpers', () => ({
  isEnterprise: vi.fn(() => false),
  isFree: vi.fn(() => false),
}))

vi.mock('@/lib/billing/subscriptions/utils', () => ({
  hasUsableSubscriptionAccess: vi.fn(() => true),
}))
vi.mock('drizzle-orm', () => ({
  eq: vi.fn(() => ({})),
}))

vi.mock('@/lib/core/config/env', () => ({
  env: {},
  envNumber: vi.fn((_value, fallback) => fallback),
}))

import { checkAndBillOverageThreshold } from '@/lib/billing/threshold-billing'

describe('checkAndBillOverageThreshold', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    selectLimitMock.mockResolvedValue([])
    getEffectiveBillingStatusMock.mockResolvedValue({ billingBlocked: false })
    isOrganizationBillingBlockedMock.mockResolvedValue(false)
    createOverageBillingClaimMock.mockResolvedValue({
      claimed: true,
      claimId: 'claim-1',
      amountToBill: 10,
      creditApplied: 0,
      overageAmount: 10,
      priorCoveredOverage: 0,
    })
  })

  it('uses the ledger claim service for personally scoped threshold billing', async () => {
    selectLimitMock.mockResolvedValue([
      {
        id: 'sub-1',
        plan: 'pro',
        referenceId: 'user-1',
        status: 'active',
        stripeCustomerId: 'cus-1',
        stripeSubscriptionId: 'stripe-sub-1',
        periodStart: new Date('2026-05-01T00:00:00Z'),
        periodEnd: new Date('2026-06-01T00:00:00Z'),
      },
    ])

    await checkAndBillOverageThreshold({
      userId: 'user-1',
      subscriptionId: 'sub-1',
      billingEntityType: 'user',
      billingEntityId: 'user-1',
    })

    expect(createOverageBillingClaimMock).toHaveBeenCalledWith(
      expect.objectContaining({
        claimType: 'threshold',
        threshold: 10,
        customerId: 'cus-1',
        stripeSubscriptionId: 'stripe-sub-1',
        enqueueStripeInvoice: true,
      })
    )
  })

  it('uses the explicit organization billing entity for team threshold billing', async () => {
    selectLimitMock.mockResolvedValue([
      {
        id: 'sub-team',
        plan: 'team',
        referenceId: 'org-1',
        status: 'active',
        stripeCustomerId: 'cus-team',
        stripeSubscriptionId: 'stripe-sub-team',
        periodStart: new Date('2026-05-01T00:00:00Z'),
        periodEnd: new Date('2026-06-01T00:00:00Z'),
      },
    ])

    await checkAndBillOverageThreshold({
      userId: 'user-1',
      subscriptionId: 'sub-team',
      billingEntityType: 'organization',
      billingEntityId: 'org-1',
    })

    expect(isOrganizationBillingBlockedMock).toHaveBeenCalledWith('org-1')
    expect(createOverageBillingClaimMock).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: 'cus-team',
        stripeSubscriptionId: 'stripe-sub-team',
        itemDescription: 'Organization usage overage',
      })
    )
  })

  it('uses the explicit organization billing entity for org-scoped Pro threshold billing', async () => {
    selectLimitMock.mockResolvedValue([
      {
        id: 'sub-pro',
        plan: 'pro',
        referenceId: 'org-1',
        status: 'active',
        stripeCustomerId: 'cus-pro',
        stripeSubscriptionId: 'stripe-sub-pro',
        periodStart: new Date('2026-05-01T00:00:00Z'),
        periodEnd: new Date('2026-06-01T00:00:00Z'),
      },
    ])

    await checkAndBillOverageThreshold({
      userId: 'user-1',
      subscriptionId: 'sub-pro',
      billingEntityType: 'organization',
      billingEntityId: 'org-1',
    })

    expect(createOverageBillingClaimMock).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: 'cus-pro',
        stripeSubscriptionId: 'stripe-sub-pro',
        itemDescription: 'Organization usage overage',
      })
    )
  })

  it('retries when Stripe identifiers are missing for a billable subscription', async () => {
    selectLimitMock.mockResolvedValue([
      {
        id: 'sub-1',
        plan: 'pro',
        referenceId: 'user-1',
        status: 'active',
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        periodStart: new Date('2026-05-01T00:00:00Z'),
        periodEnd: new Date('2026-06-01T00:00:00Z'),
      },
    ])

    await expect(
      checkAndBillOverageThreshold({
        userId: 'user-1',
        subscriptionId: 'sub-1',
        billingEntityType: 'user',
        billingEntityId: 'user-1',
      })
    ).rejects.toThrow('Stripe customer and subscription ids are required')

    expect(createOverageBillingClaimMock).not.toHaveBeenCalled()
  })

  it('propagates claim failures so outbox threshold checks can retry', async () => {
    const error = new Error('stripe unavailable')
    selectLimitMock.mockResolvedValue([
      {
        id: 'sub-1',
        plan: 'pro',
        referenceId: 'user-1',
        status: 'active',
        stripeCustomerId: 'cus-1',
        stripeSubscriptionId: 'stripe-sub-1',
        periodStart: new Date('2026-05-01T00:00:00Z'),
        periodEnd: new Date('2026-06-01T00:00:00Z'),
      },
    ])
    createOverageBillingClaimMock.mockRejectedValue(error)

    await expect(
      checkAndBillOverageThreshold({
        userId: 'user-1',
        subscriptionId: 'sub-1',
        billingEntityType: 'user',
        billingEntityId: 'user-1',
      })
    ).rejects.toThrow('stripe unavailable')
  })
})
