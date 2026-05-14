/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { tx, executeMock, insertValuesMock, updateSetMock, enqueueOutboxEventMock } = vi.hoisted(
  () => {
    const executeMock = vi.fn()
    const insertValuesMock = vi.fn()
    const updateSetMock = vi.fn()
    const tx = {
      execute: executeMock,
      insert: vi.fn(() => ({ values: insertValuesMock })),
      update: vi.fn(() => ({
        set: updateSetMock.mockImplementation(() => ({ where: vi.fn() })),
      })),
    }
    return {
      tx,
      executeMock,
      insertValuesMock,
      updateSetMock,
      enqueueOutboxEventMock: vi.fn(),
    }
  }
)

vi.mock('@sim/db', () => ({
  db: {
    transaction: vi.fn(async (operation: (transaction: typeof tx) => Promise<unknown>) =>
      operation(tx)
    ),
  },
}))

vi.mock('@sim/db/schema', () => ({
  billingClaim: {
    id: 'billing_claim.id',
    entityType: 'billing_claim.entity_type',
    entityId: 'billing_claim.entity_id',
    status: 'billing_claim.status',
    periodStart: 'billing_claim.period_start',
    periodEnd: 'billing_claim.period_end',
    amountToBill: 'billing_claim.amount_to_bill',
    creditApplied: 'billing_claim.credit_applied',
    outboxEventId: 'billing_claim.outbox_event_id',
  },
  billingClaimUsage: {
    claimId: 'billing_claim_usage.claim_id',
    usageLogId: 'billing_claim_usage.usage_log_id',
    allocatedAmount: 'billing_claim_usage.allocated_amount',
  },
  outboxEvent: {
    id: 'outbox_event.id',
    status: 'outbox_event.status',
  },
  organization: {
    id: 'organization.id',
    creditBalance: 'organization.credit_balance',
  },
  member: {
    userId: 'member.user_id',
    organizationId: 'member.organization_id',
    createdAt: 'member.created_at',
  },
  subscription: {
    referenceId: 'subscription.reference_id',
    status: 'subscription.status',
    periodStart: 'subscription.period_start',
    periodEnd: 'subscription.period_end',
    plan: 'subscription.plan',
  },
  usageLog: {
    id: 'usage_log.id',
    cost: 'usage_log.cost',
    source: 'usage_log.source',
    userId: 'usage_log.user_id',
    createdAt: 'usage_log.created_at',
    billingEntityType: 'usage_log.billing_entity_type',
    billingEntityId: 'usage_log.billing_entity_id',
  },
  userStats: {
    userId: 'user_stats.user_id',
    creditBalance: 'user_stats.credit_balance',
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

vi.mock('@sim/utils/id', () => {
  let counter = 0
  return {
    generateId: vi.fn(() => `generated-${++counter}`),
  }
})

vi.mock('@/lib/billing/core/plan', () => ({
  getHighestPrioritySubscription: vi.fn(),
}))

vi.mock('@/lib/billing/plan-helpers', () => ({
  getPlanTierDollars: vi.fn(() => 0),
  isPooledOrganizationPlan: vi.fn((plan: string | null | undefined) =>
    Boolean(plan === 'enterprise' || plan?.startsWith('team'))
  ),
  sqlOrganizationSubscriptionOwnsMemberUsage: vi.fn(() => ({})),
}))

vi.mock('@/lib/billing/subscriptions/utils', () => ({
  ENTITLED_SUBSCRIPTION_STATUSES: ['active', 'trialing', 'past_due'],
  getPlanPricing: vi.fn(() => ({ basePrice: 20 })),
  isOrgScopedSubscription: vi.fn(() => false),
}))

vi.mock('@/lib/billing/webhooks/outbox-types', () => ({
  OUTBOX_EVENT_TYPES: {
    STRIPE_THRESHOLD_OVERAGE_INVOICE: 'stripe.threshold-overage-invoice',
  },
}))

vi.mock('@/lib/core/outbox/service', () => ({
  enqueueOutboxEvent: enqueueOutboxEventMock,
}))

import { createOverageBillingClaim } from '@/lib/billing/ledger/usage-ledger'

describe('createOverageBillingClaim', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    executeMock.mockResolvedValue([])
    insertValuesMock.mockResolvedValue(undefined)
    updateSetMock.mockImplementation(() => ({ where: vi.fn() }))
    enqueueOutboxEventMock.mockResolvedValue('outbox-1')
  })

  it('claims unallocated usage, applies credits, and enqueues Stripe work after allocation', async () => {
    let executeCall = 0
    executeMock.mockImplementation(async () => {
      executeCall += 1
      switch (executeCall) {
        case 1:
        case 2:
        case 3:
          return []
        case 4:
        case 5:
          return [{ total: '35' }]
        case 6:
        case 7:
          return [{ total: '0' }]
        case 8:
          return [
            { id: 'usage-1', cost: '20', allocated_amount: '0' },
            { id: 'usage-2', cost: '15', allocated_amount: '0' },
          ]
        case 9:
          return [{ old_balance: '5' }]
        default:
          return []
      }
    })

    const result = await createOverageBillingClaim({
      subscription: {
        id: 'sub-1',
        plan: 'pro',
        referenceId: 'user-1',
        periodStart: new Date('2026-05-01T00:00:00Z'),
        periodEnd: new Date('2026-06-01T00:00:00Z'),
      },
      claimType: 'threshold',
      periodStart: new Date('2026-05-01T00:00:00Z'),
      periodEnd: new Date('2026-06-01T00:00:00Z'),
      usageCutoff: new Date('2026-05-15T00:00:00Z'),
      customerId: 'cus-1',
      stripeSubscriptionId: 'stripe-sub-1',
      enqueueStripeInvoice: true,
    })

    expect(result).toMatchObject({
      claimed: true,
      amountToBill: 10,
      creditApplied: 5,
      overageAmount: 15,
      usageLogIds: ['usage-2'],
    })
    expect(enqueueOutboxEventMock).toHaveBeenCalledWith(
      tx,
      'stripe.threshold-overage-invoice',
      expect.objectContaining({ claimId: 'generated-1', amountCents: 1000 })
    )
    expect(insertValuesMock).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          claimId: 'generated-1',
          usageLogId: 'usage-2',
          allocatedAmount: '15',
        }),
      ])
    )
  })

  it('can allocate the unclaimed remainder of a partially covered usage row', async () => {
    let executeCall = 0
    executeMock.mockImplementation(async () => {
      executeCall += 1
      switch (executeCall) {
        case 1:
        case 2:
        case 3:
          return []
        case 4:
        case 5:
          return [{ total: '150' }]
        case 6:
          return [{ total: '20' }]
        case 7:
          return [{ total: '0' }]
        case 8:
          return [
            { id: 'usage-1', cost: '100', allocated_amount: '20' },
            { id: 'usage-2', cost: '50', allocated_amount: '0' },
          ]
        case 9:
          return [{ old_balance: '0' }]
        default:
          return []
      }
    })

    const result = await createOverageBillingClaim({
      subscription: {
        id: 'sub-1',
        plan: 'pro',
        referenceId: 'user-1',
        periodStart: new Date('2026-05-01T00:00:00Z'),
        periodEnd: new Date('2026-06-01T00:00:00Z'),
      },
      claimType: 'final',
      periodStart: new Date('2026-05-01T00:00:00Z'),
      periodEnd: new Date('2026-06-01T00:00:00Z'),
      usageCutoff: new Date('2026-06-01T00:00:00Z'),
      customerId: 'cus-1',
      stripeSubscriptionId: 'stripe-sub-1',
      enqueueStripeInvoice: true,
    })

    expect(result).toMatchObject({
      claimed: true,
      amountToBill: 110,
      creditApplied: 0,
      overageAmount: 110,
      priorCoveredOverage: 20,
      usageLogIds: ['usage-1', 'usage-2'],
    })
    expect(insertValuesMock).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          usageLogId: 'usage-1',
          allocatedAmount: '60',
        }),
        expect.objectContaining({
          usageLogId: 'usage-2',
          allocatedAmount: '50',
        }),
      ])
    )
  })

  it('does not create a claim when covered usage is below the threshold', async () => {
    executeMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ total: '25' }])
      .mockResolvedValueOnce([{ total: '25' }])
      .mockResolvedValueOnce([{ total: '0' }])
      .mockResolvedValueOnce([{ total: '0' }])

    const result = await createOverageBillingClaim({
      subscription: {
        id: 'sub-1',
        plan: 'pro',
        referenceId: 'user-1',
        periodStart: new Date('2026-05-01T00:00:00Z'),
        periodEnd: new Date('2026-06-01T00:00:00Z'),
      },
      claimType: 'threshold',
      threshold: 10,
      periodStart: new Date('2026-05-01T00:00:00Z'),
      periodEnd: new Date('2026-06-01T00:00:00Z'),
      usageCutoff: new Date('2026-05-15T00:00:00Z'),
    })

    expect(result.claimed).toBe(false)
    expect(insertValuesMock).not.toHaveBeenCalled()
    expect(enqueueOutboxEventMock).not.toHaveBeenCalled()
  })
})
