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

const { mockBlockOrgMembers, mockUnblockOrgMembers } = vi.hoisted(() => ({
  mockBlockOrgMembers: vi.fn(),
  mockUnblockOrgMembers: vi.fn(),
}))

vi.mock('@sim/db', () => dbChainMock)
vi.mock('drizzle-orm', () => drizzleOrmMock)

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
  type: 'invoice.payment_failed' | 'invoice.payment_succeeded',
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
