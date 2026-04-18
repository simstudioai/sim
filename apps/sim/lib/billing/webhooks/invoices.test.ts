/**
 * @vitest-environment node
 */
import type Stripe from 'stripe'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockBlockOrgMembers, mockDbSelect, mockLogger, mockUnblockOrgMembers, selectResponses } =
  vi.hoisted(() => {
    const selectResponses: Array<{ limitResult?: unknown; whereResult?: unknown }> = []
    const mockDbSelect = vi.fn(() => {
      const nextResponse = selectResponses.shift()

      if (!nextResponse) {
        throw new Error('No queued db.select response')
      }

      const builder = {
        from: vi.fn(() => builder),
        where: vi.fn(() => builder),
        limit: vi.fn(async () => nextResponse.limitResult ?? nextResponse.whereResult ?? []),
        then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
          Promise.resolve(nextResponse.whereResult ?? nextResponse.limitResult ?? []).then(
            resolve,
            reject
          ),
      }

      return builder
    })

    return {
      mockBlockOrgMembers: vi.fn(),
      mockDbSelect,
      mockLogger: {
        debug: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
      },
      mockUnblockOrgMembers: vi.fn(),
      selectResponses,
    }
  })

vi.mock('@sim/db', () => ({
  db: {
    select: mockDbSelect,
  },
}))

vi.mock('@sim/db/schema', () => ({
  member: {
    organizationId: 'member.organizationId',
    role: 'member.role',
    userId: 'member.userId',
  },
  organization: {},
  subscription: {
    referenceId: 'subscription.referenceId',
    stripeSubscriptionId: 'subscription.stripeSubscriptionId',
  },
  user: {
    email: 'user.email',
    id: 'user.id',
    name: 'user.name',
  },
  userStats: {
    billingBlocked: 'userStats.billingBlocked',
    billingBlockedReason: 'userStats.billingBlockedReason',
    userId: 'userStats.userId',
  },
}))

vi.mock('@sim/logger', () => ({
  createLogger: vi.fn(() => mockLogger),
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn(() => 'and'),
  eq: vi.fn(() => 'eq'),
  inArray: vi.fn(() => 'inArray'),
  isNull: vi.fn(() => 'isNull'),
  ne: vi.fn(() => 'ne'),
  or: vi.fn(() => 'or'),
}))

vi.mock('@/components/emails', () => ({
  PaymentFailedEmail: vi.fn(),
  getEmailSubject: vi.fn(),
  renderCreditPurchaseEmail: vi.fn(),
}))

vi.mock('@/lib/billing/core/billing', () => ({
  calculateSubscriptionOverage: vi.fn(),
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

vi.mock('@/lib/billing/organizations/membership', () => ({
  blockOrgMembers: mockBlockOrgMembers,
  unblockOrgMembers: mockUnblockOrgMembers,
}))

vi.mock('@/lib/billing/plan-helpers', () => ({
  isEnterprise: vi.fn(() => false),
  isOrgPlan: vi.fn((plan: string | null | undefined) => Boolean(plan?.startsWith('team'))),
  isTeam: vi.fn((plan: string | null | undefined) => Boolean(plan?.startsWith('team'))),
}))

vi.mock('@/lib/billing/stripe-client', () => ({
  requireStripeClient: vi.fn(),
}))

vi.mock('@/lib/billing/stripe-payment-method', () => ({
  resolveDefaultPaymentMethod: vi.fn(async () => ({
    paymentMethodId: undefined,
    collectionMethod: 'charge_automatically',
  })),
  getPaymentMethodId: vi.fn(),
  getCustomerId: vi.fn(),
}))

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

vi.mock('@/lib/core/utils/urls', () => ({
  getBaseUrl: vi.fn(() => 'https://sim.test'),
}))

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

import { handleInvoicePaymentFailed, handleInvoicePaymentSucceeded } from './invoices'

function queueSelectResponse(response: { limitResult?: unknown; whereResult?: unknown }) {
  selectResponses.push(response)
}

function createInvoiceEvent(
  type: 'invoice.payment_failed' | 'invoice.payment_succeeded',
  invoice: Partial<Stripe.Invoice>
): Stripe.Event {
  return {
    data: {
      object: invoice as Stripe.Invoice,
    },
    id: `evt_${type}`,
    type,
  } as Stripe.Event
}

describe('invoice billing recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    selectResponses.length = 0
    mockBlockOrgMembers.mockResolvedValue(2)
    mockUnblockOrgMembers.mockResolvedValue(2)
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

    expect(mockUnblockOrgMembers).toHaveBeenCalledWith('org-1', 'payment_failed')
    expect(mockBlockOrgMembers).not.toHaveBeenCalled()
  })
})
