/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCalculateSubscriptionOverage,
  mockComputeOrgOverageAmount,
  mockDbSelect,
  mockDbTransaction,
  mockEnqueueOutboxEvent,
  mockGetEffectiveBillingStatus,
  mockGetHighestPrioritySubscription,
  mockGetOrganizationSubscriptionUsable,
  mockHasUsableSubscriptionAccess,
  mockIsEnterprise,
  mockIsFree,
  mockIsOrgScopedSubscription,
  mockIsOrganizationBillingBlocked,
  mockTxExecute,
  mockTxSelect,
  mockTxStatsLimit,
  mockTxUpdate,
} = vi.hoisted(() => ({
  mockCalculateSubscriptionOverage: vi.fn(),
  mockComputeOrgOverageAmount: vi.fn(),
  mockDbSelect: vi.fn(),
  mockDbTransaction: vi.fn(),
  mockEnqueueOutboxEvent: vi.fn(),
  mockGetEffectiveBillingStatus: vi.fn(),
  mockGetHighestPrioritySubscription: vi.fn(),
  mockGetOrganizationSubscriptionUsable: vi.fn(),
  mockHasUsableSubscriptionAccess: vi.fn(),
  mockIsEnterprise: vi.fn(),
  mockIsFree: vi.fn(),
  mockIsOrgScopedSubscription: vi.fn(),
  mockIsOrganizationBillingBlocked: vi.fn(),
  mockTxExecute: vi.fn(),
  mockTxSelect: vi.fn(),
  mockTxStatsLimit: vi.fn(),
  mockTxUpdate: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  db: {
    select: mockDbSelect,
    transaction: mockDbTransaction,
  },
}))

vi.mock('@sim/db/schema', () => ({
  member: {
    organizationId: 'member.organizationId',
    role: 'member.role',
    userId: 'member.userId',
  },
  organization: {
    creditBalance: 'organization.creditBalance',
    departedMemberUsage: 'organization.departedMemberUsage',
    id: 'organization.id',
  },
  subscription: {
    id: 'subscription.id',
    stripeCustomerId: 'subscription.stripeCustomerId',
  },
  userStats: {
    billedOverageThisPeriod: 'userStats.billedOverageThisPeriod',
    creditBalance: 'userStats.creditBalance',
    currentPeriodCost: 'userStats.currentPeriodCost',
    userId: 'userStats.userId',
  },
}))

vi.mock('@/lib/billing/core/access', () => ({
  getEffectiveBillingStatus: mockGetEffectiveBillingStatus,
  isOrganizationBillingBlocked: mockIsOrganizationBillingBlocked,
}))

vi.mock('@/lib/billing/core/billing', () => ({
  calculateSubscriptionOverage: mockCalculateSubscriptionOverage,
  computeOrgOverageAmount: mockComputeOrgOverageAmount,
}))

vi.mock('@/lib/billing/core/subscription', () => ({
  getHighestPrioritySubscription: mockGetHighestPrioritySubscription,
  getOrganizationSubscriptionUsable: mockGetOrganizationSubscriptionUsable,
}))

vi.mock('@/lib/billing/plan-helpers', () => ({
  isEnterprise: mockIsEnterprise,
  isFree: mockIsFree,
}))

vi.mock('@/lib/billing/subscriptions/utils', () => ({
  hasUsableSubscriptionAccess: mockHasUsableSubscriptionAccess,
  isOrgScopedSubscription: mockIsOrgScopedSubscription,
}))

vi.mock('@/lib/billing/webhooks/outbox-handlers', () => ({
  OUTBOX_EVENT_TYPES: {
    STRIPE_THRESHOLD_OVERAGE_INVOICE: 'stripe.threshold-overage-invoice',
  },
}))

vi.mock('@/lib/core/config/env', () => ({
  env: {},
  envNumber: vi.fn((_value: string | undefined, fallback: number) => fallback),
}))

vi.mock('@/lib/core/outbox/service', () => ({
  enqueueOutboxEvent: mockEnqueueOutboxEvent,
}))

import { checkAndBillOverageThreshold } from '@/lib/billing/threshold-billing'

interface MockTx {
  execute: typeof mockTxExecute
  select: typeof mockTxSelect
  update: typeof mockTxUpdate
}

const userSubscription = {
  id: 'sub-db-1',
  plan: 'pro',
  referenceId: 'user-1',
  seats: 1,
  periodStart: new Date('2026-05-01T00:00:00.000Z'),
  periodEnd: new Date('2026-06-01T00:00:00.000Z'),
  stripeSubscriptionId: 'sub_stripe_1',
  status: 'active',
}

function buildCustomerSelectChain(customerId = 'cus_1') {
  return {
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(async () => [{ stripeCustomerId: customerId }]),
      })),
    })),
  }
}

function buildStatsSelectChain() {
  return {
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        for: vi.fn(() => ({
          limit: mockTxStatsLimit,
        })),
      })),
    })),
  }
}

function buildUpdateChain() {
  return {
    set: vi.fn(() => ({
      where: vi.fn(async () => []),
    })),
  }
}

describe('checkAndBillOverageThreshold', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockGetHighestPrioritySubscription.mockResolvedValue(userSubscription)
    mockGetEffectiveBillingStatus.mockResolvedValue({ billingBlocked: false })
    mockHasUsableSubscriptionAccess.mockReturnValue(true)
    mockIsFree.mockReturnValue(false)
    mockIsEnterprise.mockReturnValue(false)
    mockIsOrgScopedSubscription.mockReturnValue(false)
    mockDbSelect.mockImplementation(() => buildCustomerSelectChain())
    mockTxSelect.mockImplementation(() => buildStatsSelectChain())
    mockTxUpdate.mockImplementation(() => buildUpdateChain())
    mockTxExecute.mockResolvedValue(undefined)
    mockDbTransaction.mockImplementation(async (callback: (tx: MockTx) => Promise<void>) =>
      callback({ execute: mockTxExecute, select: mockTxSelect, update: mockTxUpdate })
    )
  })

  it('does not lock user_stats when calculated overage is below threshold', async () => {
    mockCalculateSubscriptionOverage.mockResolvedValue(99)

    await checkAndBillOverageThreshold('user-1')

    expect(mockCalculateSubscriptionOverage).toHaveBeenCalledWith({
      id: userSubscription.id,
      plan: userSubscription.plan,
      referenceId: userSubscription.referenceId,
      seats: userSubscription.seats,
      periodStart: userSubscription.periodStart,
      periodEnd: userSubscription.periodEnd,
    })
    expect(mockDbTransaction).not.toHaveBeenCalled()
    expect(mockDbSelect).not.toHaveBeenCalled()
    expect(mockEnqueueOutboxEvent).not.toHaveBeenCalled()
  })

  it('calculates overage before opening the short user_stats transaction', async () => {
    mockCalculateSubscriptionOverage.mockResolvedValue(250)
    mockTxStatsLimit.mockResolvedValue([{ billedOverageThisPeriod: '0', creditBalance: '0' }])

    await checkAndBillOverageThreshold('user-1')

    expect(mockCalculateSubscriptionOverage).toHaveBeenCalled()
    expect(mockDbTransaction).toHaveBeenCalled()
    expect(mockCalculateSubscriptionOverage.mock.invocationCallOrder[0]).toBeLessThan(
      mockDbTransaction.mock.invocationCallOrder[0]
    )
    expect(mockTxExecute).toHaveBeenCalledTimes(1)
    expect(mockEnqueueOutboxEvent).toHaveBeenCalledTimes(1)
  })

  it('rechecks billed overage while locked before enqueueing an invoice', async () => {
    mockCalculateSubscriptionOverage.mockResolvedValue(250)
    mockTxStatsLimit.mockResolvedValue([{ billedOverageThisPeriod: '200', creditBalance: '0' }])

    await checkAndBillOverageThreshold('user-1')

    expect(mockDbTransaction).toHaveBeenCalled()
    expect(mockTxExecute).toHaveBeenCalledTimes(1)
    expect(mockTxUpdate).not.toHaveBeenCalled()
    expect(mockEnqueueOutboxEvent).not.toHaveBeenCalled()
  })
})
