import { billingCoreMock, billingCoreMockFns } from '@sim/testing/mocks/billing-core.mock'
import {
  billingPlanHelpersMock,
  billingPlanHelpersMockFns,
} from '@sim/testing/mocks/billing-plan-helpers.mock'
import { billingSubscriptionUtilsMock } from '@sim/testing/mocks/billing-subscription-utils.mock'
import {
  billingUsageLogMock,
  billingUsageLogMockFns,
} from '@sim/testing/mocks/billing-usage-log.mock'
import { dbChainMockFns, resetDbChainMock } from '@sim/testing/mocks/database.mock'
import { emailMailerMock } from '@sim/testing/mocks/email-mailer.mock'
import { emailTemplatesMock } from '@sim/testing/mocks/email-templates.mock'
import {
  organizationMembershipMock,
  organizationMembershipMockFns,
} from '@sim/testing/mocks/organization-membership.mock'
import {
  createMockStripeEvent,
  stripeClientMock,
  stripePaymentMethodMock,
} from '@sim/testing/mocks/stripe.mock'
import { urlsMockFns } from '@sim/testing/mocks/urls.mock'
import type Stripe from 'stripe'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/components/emails', () => emailTemplatesMock)

vi.mock('@/lib/billing/core/billing', () => billingCoreMock)

vi.mock('@/lib/billing/core/usage-log', () => billingUsageLogMock)

vi.mock('@/lib/billing/credits/balance', () => ({
  addCredits: vi.fn(),
  getCreditBalance: vi.fn(),
  removeCredits: vi.fn(),
}))

vi.mock('@/lib/billing/credits/purchase', () => ({
  setUsageLimitForCredits: vi.fn(),
}))

vi.mock('@/lib/billing/organizations/membership', () => organizationMembershipMock)

vi.mock('@/lib/billing/plan-helpers', () => billingPlanHelpersMock)

vi.mock('@/lib/billing/stripe-client', () => stripeClientMock)
vi.mock('@/lib/billing/stripe-payment-method', () => stripePaymentMethodMock)

vi.mock('@/lib/billing/subscriptions/utils', () => billingSubscriptionUtilsMock)

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

vi.mock('@/lib/messaging/email/mailer', () => emailMailerMock)

vi.mock('@/lib/messaging/email/utils', () => ({
  getPersonalEmailFrom: vi.fn(() => ({
    from: 'billing@sim.test',
    replyTo: 'support@sim.test',
  })),
  getHelpEmailAddress: vi.fn(() => 'help@sim.test'),
}))

vi.mock('@/lib/messaging/email/validation', () => ({
  quickValidateEmail: vi.fn(() => ({ isValid: true })),
}))

import {
  handleInvoicePaymentFailed,
  handleInvoicePaymentSucceeded,
} from '@/lib/billing/webhooks/invoices'

const { mockBlockOrgMembers, mockUnblockOrgMembers } = organizationMembershipMockFns
billingCoreMockFns.mockIsSubscriptionOrgScoped.mockResolvedValue(true)
billingUsageLogMockFns.mockGetBillingPeriodUsageCostByUser.mockResolvedValue(new Map())
billingPlanHelpersMockFns.mockIsEnterprise.mockReturnValue(false)
billingPlanHelpersMockFns.mockIsOrgPlan.mockImplementation((plan) =>
  Boolean(plan?.startsWith('team'))
)
billingPlanHelpersMockFns.mockIsTeam.mockImplementation((plan) => Boolean(plan?.startsWith('team')))

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
      for: vi.fn(() => builder),
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
