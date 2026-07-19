/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  organizationBillingDataSchema,
  subscriptionBillingDataSchema,
} from '@/lib/api/contracts/subscription'

const PERSONAL_BILLING_DATA = {
  type: 'individual',
  plan: 'pro_6000',
  currentUsage: 8,
  usageLimit: 30,
  percentUsed: 26.67,
  isWarning: false,
  isExceeded: false,
  daysRemaining: 12,
  creditBalance: 4,
  billingInterval: 'year',
  isPaid: true,
  isPro: true,
  isTeam: false,
  isEnterprise: false,
  isOrgScoped: false,
  organizationId: null,
  status: 'active',
  seats: null,
  metadata: null,
  stripeSubscriptionId: 'sub_personal',
  periodEnd: '2026-08-01T00:00:00.000Z',
  cancelAtPeriodEnd: false,
  billingBlocked: false,
  billingBlockedReason: null,
  blockedByOrgOwner: false,
  upgradeWorkspaceId: 'workspace-personal',
  usage: {
    current: 8,
    limit: 30,
    percentUsed: 26.67,
    isWarning: false,
    isExceeded: false,
    billingPeriodStart: '2026-07-01T00:00:00.000Z',
    billingPeriodEnd: '2026-08-01T00:00:00.000Z',
    lastPeriodCost: 5,
    lastPeriodCopilotCost: 1,
    daysRemaining: 12,
    copilotCost: 2,
  },
} as const

const ORGANIZATION_BILLING_DATA = {
  organizationId: 'org-target',
  organizationName: 'Target organization',
  subscriptionState: 'active',
  hasSubscription: true,
  subscriptionPlan: 'team_25000',
  subscriptionStatus: 'active',
  creditBalance: 17,
  billingInterval: 'year',
  cancelAtPeriodEnd: true,
  totalSeats: 3,
  usedSeats: 2,
  seatsCount: 3,
  totalCurrentUsage: 21,
  totalUsageLimit: 125,
  minimumBillingAmount: 125,
  averageUsagePerMember: 10.5,
  billingPeriodStart: '2026-07-01T00:00:00.000Z',
  billingPeriodEnd: '2026-08-01T00:00:00.000Z',
  members: [],
  billingBlocked: true,
  billingBlockedReason: 'payment_failed',
  blockedByOrgOwner: true,
  upgradeWorkspaceId: 'workspace-target',
} as const

describe('subscription billing contracts', () => {
  it('requires exact personal payer status and upgrade target fields', () => {
    expect(subscriptionBillingDataSchema.safeParse(PERSONAL_BILLING_DATA).success).toBe(true)

    const { billingBlocked: _billingBlocked, ...withoutBlockedStatus } = PERSONAL_BILLING_DATA
    expect(subscriptionBillingDataSchema.safeParse(withoutBlockedStatus).success).toBe(false)

    const { upgradeWorkspaceId: _upgradeWorkspaceId, ...withoutUpgradeTarget } =
      PERSONAL_BILLING_DATA
    expect(subscriptionBillingDataSchema.safeParse(withoutUpgradeTarget).success).toBe(false)
  })

  it('requires target organization credits, interval, cancellation, and blocked status', () => {
    expect(organizationBillingDataSchema.safeParse(ORGANIZATION_BILLING_DATA).success).toBe(true)

    for (const field of [
      'creditBalance',
      'billingInterval',
      'cancelAtPeriodEnd',
      'billingBlocked',
    ] as const) {
      const incomplete = { ...ORGANIZATION_BILLING_DATA }
      delete incomplete[field]
      expect(organizationBillingDataSchema.safeParse(incomplete).success).toBe(false)
    }
  })

  it.each([
    {
      subscriptionState: 'free',
      hasSubscription: false,
      subscriptionPlan: 'free',
      subscriptionStatus: null,
    },
    {
      subscriptionState: 'lapsed',
      hasSubscription: true,
      subscriptionPlan: 'team_25000',
      subscriptionStatus: 'canceled',
    },
  ] as const)('represents $subscriptionState organization billing explicitly', (state) => {
    expect(
      organizationBillingDataSchema.safeParse({
        ...ORGANIZATION_BILLING_DATA,
        ...state,
        cancelAtPeriodEnd: false,
        billingPeriodStart: null,
        billingPeriodEnd: null,
      }).success
    ).toBe(true)
  })
})
