/**
 * @vitest-environment node
 */
import {
  createMockStripeEvent,
  dbChainMock,
  dbChainMockFns,
  drizzleOrmMock,
  resetDbChainMock,
  stripeClientMock,
  stripePaymentMethodMock,
  urlsMock,
  urlsMockFns,
} from '@sim/testing'
import type Stripe from 'stripe'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockBlockOrgMembers, mockUnblockOrgMembers, mockCreateOverageBillingClaim } = vi.hoisted(
  () => ({
    mockBlockOrgMembers: vi.fn(),
    mockUnblockOrgMembers: vi.fn(),
    mockCreateOverageBillingClaim: vi.fn(),
  })
)

vi.mock('@sim/db', () => dbChainMock)
vi.mock('drizzle-orm', () => drizzleOrmMock)
vi.mock('@sim/db/schema', () => ({
  billingClaim: {
    id: 'billing_claim.id',
    subscriptionId: 'billing_claim.subscription_id',
    status: 'billing_claim.status',
  },
  member: {
    userId: 'member.user_id',
    organizationId: 'member.organization_id',
    role: 'member.role',
  },
  organization: {
    id: 'organization.id',
    departedMemberUsage: 'organization.departed_member_usage',
  },
  subscription: {
    id: 'subscription.id',
    stripeSubscriptionId: 'subscription.stripe_subscription_id',
  },
  user: {
    id: 'user.id',
    email: 'user.email',
    stripeCustomerId: 'user.stripe_customer_id',
  },
  userStats: {
    userId: 'user_stats.user_id',
    billingBlocked: 'user_stats.billing_blocked',
    billingBlockedReason: 'user_stats.billing_blocked_reason',
    billedOverageThisPeriod: 'user_stats.billed_overage_this_period',
    proPeriodCostSnapshot: 'user_stats.pro_period_cost_snapshot',
    proPeriodCostSnapshotAt: 'user_stats.pro_period_cost_snapshot_at',
  },
}))

vi.mock('@/components/emails', () => ({
  PaymentFailedEmail: vi.fn(),
  getEmailSubject: vi.fn(),
  renderCreditPurchaseEmail: vi.fn(),
}))

vi.mock('@/lib/billing/core/billing', () => ({
  isSubscriptionOrgScoped: vi.fn().mockResolvedValue(true),
}))

vi.mock('@/lib/billing/credits/balance', () => ({
  addCredits: vi.fn(),
  getCreditBalance: vi.fn(),
  removeCredits: vi.fn(),
}))

vi.mock('@/lib/billing/credits/purchase', () => ({
  setUsageLimitForCredits: vi.fn(),
}))

vi.mock('@/lib/billing/ledger/usage-ledger', () => ({
  createOverageBillingClaim: mockCreateOverageBillingClaim,
}))

vi.mock('@/lib/billing/organizations/membership', () => ({
  blockOrgMembers: mockBlockOrgMembers,
  unblockOrgMembers: mockUnblockOrgMembers,
}))

vi.mock('@/lib/billing/plan-helpers', () => ({
  isEnterprise: vi.fn(() => false),
  isOrgPlan: vi.fn((plan: string | null | undefined) => Boolean(plan?.startsWith('team'))),
  isPooledOrganizationPlan: vi.fn((plan: string | null | undefined) =>
    Boolean(plan === 'enterprise' || plan?.startsWith('team'))
  ),
  isTeam: vi.fn((plan: string | null | undefined) => Boolean(plan?.startsWith('team'))),
}))

vi.mock('@/lib/billing/stripe-client', () => stripeClientMock)
vi.mock('@/lib/billing/stripe-payment-method', () => stripePaymentMethodMock)

vi.mock('@/lib/billing/subscriptions/utils', () => ({
  ENTITLED_SUBSCRIPTION_STATUSES: ['active', 'trialing', 'past_due'],
}))

vi.mock('@/lib/billing/utils/decimal', () => ({
  toDecimal: vi.fn((v: string | number | null | undefined) => {
    if (v === null || v === undefined || v === '') return { toNumber: () => 0 }
    return { toNumber: () => Number(v) }
  }),
  toNumber: vi.fn((d: { toNumber: () => number }) => d.toNumber()),
}))

vi.mock('@/lib/billing/webhooks/idempotency', () => ({
  stripeWebhookIdempotency: {
    executeWithIdempotency: vi.fn(
      async (_provider: string, _identifier: string, operation: () => Promise<unknown>) =>
        operation()
    ),
  },
}))

vi.mock('@/lib/core/utils/urls', () => urlsMock)

vi.mock('@/lib/messaging/email/mailer', () => ({
  sendEmail: vi.fn(),
}))

vi.mock('@/lib/messaging/email/utils', () => ({
  getPersonalEmailFrom: vi.fn(() => ({
    from: 'billing@sim.test',
    replyTo: 'support@sim.test',
  })),
}))

vi.mock('@/lib/messaging/email/validation', () => ({
  quickValidateEmail: vi.fn(() => ({ isValid: true })),
}))

vi.mock('@react-email/render', () => ({
  render: vi.fn(),
}))

import {
  handleInvoiceFinalized,
  handleInvoicePaymentFailed,
  handleInvoicePaymentSucceeded,
} from '@/lib/billing/webhooks/invoices'

interface SelectResponse {
  limitResult?: unknown
  whereResult?: unknown
}

const selectResponses: SelectResponse[] = []

function queueSelectResponse(response: SelectResponse) {
  selectResponses.push(response)
}

/**
 * Override `where` so that each select-then-where chain pops the next queued
 * response. Supports both `.limit(1)` terminals and directly-awaited `where()`.
 */
function installSelectResponseQueue() {
  dbChainMockFns.where.mockImplementation(() => {
    const next = selectResponses.shift()
    if (!next) {
      throw new Error('No queued db.select response')
    }
    const builder = {
      limit: vi.fn(async () => next.limitResult ?? next.whereResult ?? []),
      orderBy: vi.fn(async () => next.limitResult ?? next.whereResult ?? []),
      returning: vi.fn(async () => next.limitResult ?? next.whereResult ?? []),
      groupBy: vi.fn(async () => next.limitResult ?? next.whereResult ?? []),
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve(next.whereResult ?? next.limitResult ?? []).then(resolve, reject),
    }
    return builder as unknown as ReturnType<typeof dbChainMockFns.where>
  })
}

function createInvoiceEvent(
  type: 'invoice.finalized' | 'invoice.payment_failed' | 'invoice.payment_succeeded',
  invoice: Partial<Stripe.Invoice>
): Stripe.Event {
  return createMockStripeEvent(type, invoice)
}

describe('invoice billing recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    selectResponses.length = 0
    installSelectResponseQueue()
    urlsMockFns.mockGetBaseUrl.mockReturnValue('https://sim.test')
    mockBlockOrgMembers.mockResolvedValue(2)
    mockUnblockOrgMembers.mockResolvedValue(2)
    mockCreateOverageBillingClaim.mockResolvedValue({
      claimed: true,
      claimId: 'claim-1',
      grossUsage: 35,
      overageAmount: 15,
      priorCoveredOverage: 0,
      creditApplied: 5,
      amountToBill: 10,
    })
  })

  it('creates a final ledger claim for the period ending at renewal start before resetting counters', async () => {
    const subscription = {
      id: 'sub-db-1',
      plan: 'team_8000',
      referenceId: 'org-1',
      seats: 1,
      stripeSubscriptionId: 'sub_stripe_1',
      periodStart: new Date('2026-05-01T00:00:00Z'),
      periodEnd: new Date('2026-06-01T00:00:00Z'),
    }
    queueSelectResponse({ limitResult: [subscription] })
    queueSelectResponse({ whereResult: [] })
    queueSelectResponse({ whereResult: [] })

    await handleInvoiceFinalized(
      createInvoiceEvent('invoice.finalized', {
        billing_reason: 'subscription_cycle',
        customer: 'cus_123',
        id: 'in_123',
        period_end: Date.parse('2026-06-01T00:00:00Z') / 1000,
        period_start: Date.parse('2026-05-01T00:00:00Z') / 1000,
        lines: {
          data: [
            {
              period: {
                start: Date.parse('2026-06-01T00:00:00Z') / 1000,
                end: Date.parse('2026-07-01T00:00:00Z') / 1000,
              },
            },
          ],
        } as Stripe.ApiList<Stripe.InvoiceLineItem>,
        parent: {
          subscription_details: {
            subscription: 'sub_stripe_1',
          },
        } as Stripe.Invoice.Parent,
      })
    )

    expect(mockCreateOverageBillingClaim).toHaveBeenCalledWith(
      expect.objectContaining({
        subscription: expect.objectContaining({
          ...subscription,
          periodStart: new Date('2026-05-01T00:00:00Z'),
          periodEnd: new Date('2026-06-01T00:00:00Z'),
        }),
        claimType: 'final',
        periodStart: new Date('2026-05-01T00:00:00Z'),
        periodEnd: new Date('2026-06-01T00:00:00Z'),
        usageCutoff: new Date('2026-06-01T00:00:00Z'),
        customerId: 'cus_123',
        stripeSubscriptionId: 'sub_stripe_1',
        enqueueStripeInvoice: true,
      })
    )
  })

  it('derives the closed period when Better Auth has already advanced the subscription row', async () => {
    const subscription = {
      id: 'sub-db-1',
      plan: 'team_8000',
      referenceId: 'org-1',
      seats: 1,
      stripeSubscriptionId: 'sub_stripe_1',
      periodStart: new Date('2026-06-01T00:00:00Z'),
      periodEnd: new Date('2026-07-01T00:00:00Z'),
    }
    queueSelectResponse({ limitResult: [subscription] })
    queueSelectResponse({ whereResult: [] })
    queueSelectResponse({ whereResult: [] })

    await handleInvoiceFinalized(
      createInvoiceEvent('invoice.finalized', {
        billing_reason: 'subscription_cycle',
        customer: 'cus_123',
        id: 'in_123',
        period_end: Date.parse('2026-06-01T00:00:00Z') / 1000,
        period_start: Date.parse('2026-05-01T00:00:00Z') / 1000,
        lines: {
          data: [
            {
              period: {
                start: Date.parse('2026-06-01T00:00:00Z') / 1000,
                end: Date.parse('2026-07-01T00:00:00Z') / 1000,
              },
            },
          ],
        } as Stripe.ApiList<Stripe.InvoiceLineItem>,
        parent: {
          subscription_details: {
            subscription: 'sub_stripe_1',
          },
        } as Stripe.Invoice.Parent,
      })
    )

    expect(mockCreateOverageBillingClaim).toHaveBeenCalledWith(
      expect.objectContaining({
        periodStart: new Date('2026-05-01T00:00:00Z'),
        periodEnd: new Date('2026-06-01T00:00:00Z'),
        usageCutoff: new Date('2026-06-01T00:00:00Z'),
      })
    )
  })

  it('blocks org members when a metadata-backed invoice payment fails', async () => {
    queueSelectResponse({
      limitResult: [
        {
          id: 'sub-db-1',
          plan: 'team_8000',
          referenceId: 'org-1',
          stripeSubscriptionId: 'sub_stripe_1',
        },
      ],
    })

    await handleInvoicePaymentFailed(
      createInvoiceEvent('invoice.payment_failed', {
        amount_due: 3582,
        attempt_count: 2,
        customer: 'cus_123',
        customer_email: 'owner@sim.test',
        hosted_invoice_url: 'https://stripe.test/invoices/in_123',
        id: 'in_123',
        metadata: {
          billingPeriod: '2026-04',
          subscriptionId: 'sub_stripe_1',
          type: 'overage_threshold_billing_org',
        },
      })
    )

    expect(mockBlockOrgMembers).toHaveBeenCalledWith('org-1', 'payment_failed')
    expect(mockUnblockOrgMembers).not.toHaveBeenCalled()
  })

  it('unblocks org members when the matching metadata-backed invoice payment succeeds', async () => {
    queueSelectResponse({
      limitResult: [
        {
          id: 'sub-db-1',
          plan: 'team_8000',
          referenceId: 'org-1',
          stripeSubscriptionId: 'sub_stripe_1',
        },
      ],
    })
    queueSelectResponse({
      whereResult: [{ userId: 'owner-1' }, { userId: 'member-1' }],
    })
    queueSelectResponse({
      whereResult: [{ blocked: false }, { blocked: false }],
    })
    queueSelectResponse({ limitResult: [] })
    queueSelectResponse({
      whereResult: [{ userId: 'owner-1' }, { userId: 'member-1' }],
    })
    queueSelectResponse({ limitResult: [] })
    queueSelectResponse({ limitResult: [] })
    queueSelectResponse({ limitResult: [] })
    queueSelectResponse({ limitResult: [] })
    queueSelectResponse({ whereResult: [{ userId: 'owner-1' }, { userId: 'member-1' }] })

    await handleInvoicePaymentSucceeded(
      createInvoiceEvent('invoice.payment_succeeded', {
        amount_paid: 3582,
        billing_reason: 'manual',
        customer: 'cus_123',
        id: 'in_123',
        metadata: {
          billingPeriod: '2026-04',
          subscriptionId: 'sub_stripe_1',
          type: 'overage_threshold_billing_org',
        },
      })
    )

    expect(mockUnblockOrgMembers).not.toHaveBeenCalled()
    expect(mockBlockOrgMembers).not.toHaveBeenCalled()
  })
})
