import { outboxEvent, subscription } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { auditMock, auditMockFns } from '@sim/testing/mocks/audit.mock'
import { billingOutboxHandlersMock } from '@sim/testing/mocks/billing-outbox-handlers.mock'
import { organizationMembershipMock } from '@sim/testing/mocks/organization-membership.mock'
import { outboxServiceMock, outboxServiceMockFns } from '@sim/testing/mocks/outbox-service.mock'
import { stripeClientMock } from '@sim/testing/mocks/stripe.mock'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.unmock('drizzle-orm')

const hoistedMocks = vi.hoisted(() => ({
  subscriptionCancel: vi.fn(),
  invoicesList: vi.fn(),
  invoicePaymentsList: vi.fn(),
  paymentIntentsRetrieve: vi.fn(),
  chargesRetrieve: vi.fn(),
  refundsList: vi.fn(),
  refundsCreate: vi.fn(),
}))

vi.mock('@sim/audit', () => auditMock)
vi.mock('@/lib/billing/organizations/membership', () => organizationMembershipMock)
vi.mock('@/lib/billing/stripe-client', () => stripeClientMock)
vi.mock('@/lib/billing/webhooks/outbox-handlers', () => billingOutboxHandlersMock)
vi.mock('@/lib/core/outbox/service', () => outboxServiceMock)

import {
  refundDashboardSubscriptionPayment,
  requestDashboardSubscriptionCancellation,
} from '@/lib/admin/subscription-lifecycle'

const mocks = {
  ...hoistedMocks,
  enqueueOutboxEvent: outboxServiceMockFns.mockEnqueueOutboxEvent,
}

stripeClientMock.requireStripeClient.mockImplementation(() => ({
  subscriptions: { cancel: mocks.subscriptionCancel },
  invoices: { list: mocks.invoicesList },
  invoicePayments: { list: mocks.invoicePaymentsList },
  paymentIntents: { retrieve: mocks.paymentIntentsRetrieve },
  charges: { retrieve: mocks.chargesRetrieve },
  refunds: { list: mocks.refundsList, create: mocks.refundsCreate },
}))

const actor = { id: 'admin-1', name: 'Admin', email: 'admin@sim.ai' }
const activeSubscription = {
  id: 'sub-row-1',
  referenceId: 'org-1',
  stripeSubscriptionId: 'sub_stripe_1',
  status: 'active',
  cancelAtPeriodEnd: false,
  periodStart: new Date('2026-01-01T00:00:00.000Z'),
}

afterAll(resetDbChainMock)

describe('admin subscription cancellation', () => {
  beforeEach(() => {
    resetDbChainMock()
    mocks.enqueueOutboxEvent.mockResolvedValue('outbox-1')
    mocks.subscriptionCancel.mockResolvedValue({ id: 'sub_stripe_1', status: 'canceled' })
    mocks.invoicesList.mockResolvedValue({ data: [], has_more: false })
    mocks.invoicePaymentsList.mockResolvedValue({ data: [], has_more: false })
    mocks.refundsList.mockResolvedValue({ data: [], has_more: false })
    mocks.refundsCreate.mockResolvedValue({
      id: 're_1',
      amount: 2500,
      status: 'succeeded',
      metadata: {},
    })
  })

  it('durably queues immediate Stripe cancellation and leaves cleanup to the webhook', async () => {
    queueTableRows(subscription, [activeSubscription])
    queueTableRows(outboxEvent, [])

    const result = await requestDashboardSubscriptionCancellation({
      organizationId: 'org-1',
      operationId: '67e55044-10b1-426f-9247-bb680e5fe0c8',
      timing: 'immediate',
      actor,
    })

    expect(mocks.enqueueOutboxEvent).toHaveBeenCalledWith(
      expect.anything(),
      'stripe.cancel-subscription-immediately',
      expect.objectContaining({
        operationId: '67e55044-10b1-426f-9247-bb680e5fe0c8',
        subscriptionId: 'sub-row-1',
        stripeSubscriptionId: 'sub_stripe_1',
      })
    )
    expect(mocks.subscriptionCancel).not.toHaveBeenCalled()
    expect(result).toMatchObject({ status: 'pending' })
  })

  it('requeues the same dead-lettered period-end cancellation operation', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: activeSubscription.id }])
    queueTableRows(outboxEvent, [
      {
        id: 'outbox-1',
        eventType: 'stripe.sync-cancel-at-period-end',
        status: 'dead_letter',
        subscriptionId: 'sub-row-1',
        reason: 'admin-dashboard-cancel-at-period-end',
      },
    ])

    const result = await requestDashboardSubscriptionCancellation({
      organizationId: 'org-1',
      operationId: '67e55044-10b1-426f-9247-bb680e5fe0c8',
      timing: 'period_end',
      actor,
    })

    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending', attempts: 0, lastError: null })
    )
    expect(dbChainMockFns.set).toHaveBeenCalledWith({ cancelAtPeriodEnd: true })
    expect(result).toMatchObject({
      operationId: '67e55044-10b1-426f-9247-bb680e5fe0c8',
      status: 'pending',
    })
  })

  it('replays an immediate cancellation after the webhook removed active entitlement', async () => {
    queueTableRows(outboxEvent, [
      {
        id: 'outbox-1',
        eventType: 'stripe.cancel-subscription-immediately',
        status: 'completed',
        subscriptionId: 'sub-row-1',
        reason: 'admin-dashboard-cancel-immediately',
      },
    ])

    const result = await requestDashboardSubscriptionCancellation({
      organizationId: 'org-1',
      operationId: '67e55044-10b1-426f-9247-bb680e5fe0c8',
      timing: 'immediate',
      actor,
    })

    expect(result).toMatchObject({ status: 'applied' })
    expect(mocks.enqueueOutboxEvent).not.toHaveBeenCalled()
    expect(mocks.subscriptionCancel).not.toHaveBeenCalled()
  })

  it('rejects reuse of a cancellation operation id with different timing', async () => {
    queueTableRows(outboxEvent, [
      {
        id: 'outbox-1',
        eventType: 'stripe.sync-cancel-at-period-end',
        status: 'completed',
        subscriptionId: 'sub-row-1',
        reason: 'admin-dashboard-cancel-at-period-end',
      },
    ])

    await expect(
      requestDashboardSubscriptionCancellation({
        organizationId: 'org-1',
        operationId: '67e55044-10b1-426f-9247-bb680e5fe0c8',
        timing: 'immediate',
        actor,
      })
    ).rejects.toThrow('different parameters')
  })

  it('fails closed instead of guessing when an organization has multiple active subscriptions', async () => {
    queueTableRows(subscription, [
      activeSubscription,
      { ...activeSubscription, id: 'sub-row-2', stripeSubscriptionId: 'sub_stripe_2' },
    ])

    await expect(
      requestDashboardSubscriptionCancellation({
        organizationId: 'org-1',
        operationId: '67e55044-10b1-426f-9247-bb680e5fe0c8',
        timing: 'immediate',
        actor,
      })
    ).rejects.toThrow('Multiple active organization subscriptions')

    expect(mocks.subscriptionCancel).not.toHaveBeenCalled()
  })
})

describe('admin subscription billing actions', () => {
  beforeEach(() => {
    resetDbChainMock()
    mocks.invoicesList.mockResolvedValue({
      data: [{ id: 'in_1', description: 'Annual Enterprise invoice' }],
      has_more: false,
    })
    mocks.invoicePaymentsList.mockResolvedValue({
      data: [
        {
          id: 'ip_1',
          status: 'paid',
          payment: {
            charge: {
              id: 'ch_1',
              paid: true,
              amount_captured: 10_000,
              amount_refunded: 0,
              currency: 'usd',
              created: 1_700_000_000,
              description: null,
            },
          },
        },
      ],
      has_more: false,
    })
    mocks.refundsList.mockResolvedValue({ data: [], has_more: false })
    mocks.refundsCreate.mockResolvedValue({ id: 're_1', status: 'succeeded', amount: 2500 })
  })

  it('replays a completed refund operation from Stripe metadata without a second mutation', async () => {
    queueTableRows(subscription, [activeSubscription])
    mocks.invoicePaymentsList.mockResolvedValue({
      data: [
        {
          id: 'ip_1',
          status: 'paid',
          payment: {
            charge: {
              id: 'ch_1',
              paid: true,
              amount_captured: 10_000,
              amount_refunded: 10_000,
              currency: 'usd',
              created: 1_700_000_000,
              description: null,
            },
          },
        },
      ],
      has_more: false,
    })
    mocks.refundsList.mockResolvedValue({
      data: [
        {
          id: 're_existing',
          amount: 2500,
          status: 'succeeded',
          reason: 'requested_by_customer',
          metadata: {
            simAdminOperationId: '67e55044-10b1-426f-9247-bb680e5fe0c8',
            organizationId: 'org-1',
            simSubscriptionId: 'sub-row-1',
          },
        },
      ],
      has_more: false,
    })

    const result = await refundDashboardSubscriptionPayment({
      organizationId: 'org-1',
      operationId: '67e55044-10b1-426f-9247-bb680e5fe0c8',
      chargeId: 'ch_1',
      amountCents: 2500,
      reason: 'requested_by_customer',
      actor,
    })

    expect(mocks.refundsCreate).not.toHaveBeenCalled()
    expect(mocks.invoicesList).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      refundId: 're_existing',
      amountCents: 2500,
      outcome: 'applied',
    })
    expect(auditMockFns.mockRecordAuditOnce).toHaveBeenCalledWith(
      'admin-refund:67e55044-10b1-426f-9247-bb680e5fe0c8',
      expect.objectContaining({
        action: 'subscription.refunded',
        resourceId: 'sub-row-1',
        metadata: expect.objectContaining({ refundId: 're_existing' }),
      })
    )
  })

  it('keeps a provider-pending refund recoverable without recording it as applied', async () => {
    queueTableRows(subscription, [activeSubscription])
    mocks.refundsCreate.mockResolvedValue({
      id: 're_pending',
      amount: 2500,
      status: 'pending',
      metadata: {},
    })

    const result = await refundDashboardSubscriptionPayment({
      organizationId: 'org-1',
      operationId: '67e55044-10b1-426f-9247-bb680e5fe0c8',
      chargeId: 'ch_1',
      amountCents: 2500,
      reason: 'requested_by_customer',
      actor,
    })

    expect(result).toMatchObject({ refundId: 're_pending', outcome: 'pending' })
    expect(auditMockFns.mockRecordAuditOnce).not.toHaveBeenCalled()
  })

  it('fails closed when the durable refund marker could be outside the bounded Stripe page', async () => {
    queueTableRows(subscription, [activeSubscription])
    mocks.refundsList.mockResolvedValue({ data: [], has_more: true })

    await expect(
      refundDashboardSubscriptionPayment({
        organizationId: 'org-1',
        operationId: '67e55044-10b1-426f-9247-bb680e5fe0c8',
        chargeId: 'ch_1',
        amountCents: 2500,
        reason: 'requested_by_customer',
        actor,
      })
    ).rejects.toThrow('Could not safely verify this refund operation')
    expect(mocks.refundsCreate).not.toHaveBeenCalled()
  })

  it('does not report a terminal Stripe refund failure as success', async () => {
    queueTableRows(subscription, [activeSubscription])
    mocks.refundsList.mockResolvedValue({
      data: [
        {
          id: 're_failed',
          amount: 2500,
          status: 'failed',
          reason: 'requested_by_customer',
          metadata: {
            simAdminOperationId: '67e55044-10b1-426f-9247-bb680e5fe0c8',
            organizationId: 'org-1',
            simSubscriptionId: 'sub-row-1',
          },
        },
      ],
      has_more: false,
    })

    const result = await refundDashboardSubscriptionPayment({
      organizationId: 'org-1',
      operationId: '67e55044-10b1-426f-9247-bb680e5fe0c8',
      chargeId: 'ch_1',
      amountCents: 2500,
      reason: 'requested_by_customer',
      actor,
    })

    expect(result).toMatchObject({ refundId: 're_failed', outcome: 'failed' })
    expect(mocks.refundsCreate).not.toHaveBeenCalled()
    expect(auditMockFns.mockRecordAuditOnce).not.toHaveBeenCalled()
  })

  it('creates a refund with the durable client operation ID as Stripe idempotency key', async () => {
    queueTableRows(subscription, [activeSubscription])

    await refundDashboardSubscriptionPayment({
      organizationId: 'org-1',
      operationId: '67e55044-10b1-426f-9247-bb680e5fe0c8',
      chargeId: 'ch_1',
      amountCents: 2500,
      reason: 'requested_by_customer',
      actor,
    })

    expect(mocks.refundsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        charge: 'ch_1',
        amount: 2500,
        metadata: expect.objectContaining({ simSubscriptionId: 'sub-row-1' }),
      }),
      { idempotencyKey: 'admin-refund:67e55044-10b1-426f-9247-bb680e5fe0c8' }
    )
  })

  it('rejects a new refund above the remaining refundable balance', async () => {
    queueTableRows(subscription, [activeSubscription])
    mocks.invoicePaymentsList.mockResolvedValue({
      data: [
        {
          id: 'ip_1',
          status: 'paid',
          payment: {
            charge: {
              id: 'ch_1',
              paid: true,
              amount_captured: 10_000,
              amount_refunded: 7_500,
              currency: 'usd',
              created: 1_700_000_000,
              description: null,
            },
          },
        },
      ],
      has_more: false,
    })

    await expect(
      refundDashboardSubscriptionPayment({
        organizationId: 'org-1',
        operationId: '67e55044-10b1-426f-9247-bb680e5fe0c8',
        chargeId: 'ch_1',
        amountCents: 3_000,
        reason: 'requested_by_customer',
        actor,
      })
    ).rejects.toThrow('remaining refundable balance')
    expect(mocks.refundsCreate).not.toHaveBeenCalled()
  })
})
