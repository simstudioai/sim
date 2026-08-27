/** @vitest-environment node */

import { outboxEvent, subscription } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.unmock('drizzle-orm')

const mocks = vi.hoisted(() => ({
  acquireOrganizationMutationLock: vi.fn(),
  enqueueOutboxEvent: vi.fn(),
  subscriptionCancel: vi.fn(),
  invoicesList: vi.fn(),
  invoicePaymentsList: vi.fn(),
  paymentIntentsRetrieve: vi.fn(),
  chargesRetrieve: vi.fn(),
  refundsList: vi.fn(),
  refundsCreate: vi.fn(),
  recordAuditOnce: vi.fn(),
}))

vi.mock('@sim/audit', () => ({
  AuditAction: {
    SUBSCRIPTION_CANCELLED: 'subscription.cancelled',
    SUBSCRIPTION_REFUNDED: 'subscription.refunded',
  },
  AuditResourceType: { SUBSCRIPTION: 'subscription' },
  recordAudit: vi.fn(),
  recordAuditOnce: mocks.recordAuditOnce,
}))
vi.mock('@/lib/billing/organizations/membership', () => ({
  acquireOrganizationMutationLock: mocks.acquireOrganizationMutationLock,
}))
vi.mock('@/lib/billing/stripe-client', () => ({
  requireStripeClient: () => ({
    subscriptions: { cancel: mocks.subscriptionCancel },
    invoices: { list: mocks.invoicesList },
    invoicePayments: { list: mocks.invoicePaymentsList },
    paymentIntents: { retrieve: mocks.paymentIntentsRetrieve },
    charges: { retrieve: mocks.chargesRetrieve },
    refunds: { list: mocks.refundsList, create: mocks.refundsCreate },
  }),
}))
vi.mock('@/lib/billing/webhooks/outbox-handlers', () => ({
  OUTBOX_EVENT_TYPES: {
    STRIPE_SYNC_CANCEL_AT_PERIOD_END: 'stripe.sync-cancel-at-period-end',
    STRIPE_CANCEL_SUBSCRIPTION_IMMEDIATELY: 'stripe.cancel-subscription-immediately',
  },
}))
vi.mock('@/lib/core/outbox/service', () => ({
  enqueueOutboxEvent: mocks.enqueueOutboxEvent,
}))

import {
  getDashboardSubscriptionBillingActions,
  refundDashboardSubscriptionPayment,
  requestDashboardSubscriptionCancellation,
} from '@/lib/admin/subscription-lifecycle'

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
    vi.clearAllMocks()
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

  it('uses the existing cancel-at-period-end outbox flow', async () => {
    queueTableRows(outboxEvent, [])
    queueTableRows(subscription, [activeSubscription])

    const result = await requestDashboardSubscriptionCancellation({
      organizationId: 'org-1',
      operationId: '67e55044-10b1-426f-9247-bb680e5fe0c8',
      timing: 'period_end',
      actor,
    })

    expect(dbChainMockFns.set).toHaveBeenCalledWith({ cancelAtPeriodEnd: true })
    expect(mocks.enqueueOutboxEvent).toHaveBeenCalledWith(
      expect.anything(),
      'stripe.sync-cancel-at-period-end',
      expect.objectContaining({
        subscriptionId: 'sub-row-1',
        stripeSubscriptionId: 'sub_stripe_1',
      })
    )
    expect(mocks.subscriptionCancel).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      operationId: '67e55044-10b1-426f-9247-bb680e5fe0c8',
      status: 'pending',
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
    vi.clearAllMocks()
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

  it('uses a bounded recent paid-invoice query with expanded payment charges', async () => {
    queueTableRows(subscription, [activeSubscription])

    const result = await getDashboardSubscriptionBillingActions('org-1')

    expect(mocks.invoicesList).toHaveBeenCalledWith({
      subscription: 'sub_stripe_1',
      limit: 12,
      expand: ['data.payments'],
    })
    expect(mocks.invoicePaymentsList).toHaveBeenCalledWith(
      expect.objectContaining({
        invoice: 'in_1',
        limit: 10,
        expand: ['data.payment.charge', 'data.payment.payment_intent.latest_charge'],
      })
    )
    expect(mocks.chargesRetrieve).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      cancellationSync: null,
      refundHistoryLimited: false,
      refundablePayments: [{ chargeId: 'ch_1', refundableCents: 10_000 }],
    })
  })

  it('uses expanded invoice payments without one extra Stripe request per invoice', async () => {
    queueTableRows(subscription, [activeSubscription])
    mocks.invoicesList.mockResolvedValue({
      data: [
        {
          id: 'in_1',
          description: 'Annual Enterprise invoice',
          payments: {
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
          },
        },
      ],
      has_more: false,
    })

    const result = await getDashboardSubscriptionBillingActions('org-1')

    expect(mocks.invoicePaymentsList).not.toHaveBeenCalled()
    expect(result.refundablePayments).toEqual([
      expect.objectContaining({ chargeId: 'ch_1', refundableCents: 10_000 }),
    ])
  })

  it('surfaces a failed dashboard cancellation operation separately from DB desired state', async () => {
    queueTableRows(subscription, [{ ...activeSubscription, cancelAtPeriodEnd: true }])
    queueTableRows(outboxEvent, [
      {
        operationId: '67e55044-10b1-426f-9247-bb680e5fe0c8',
        status: 'dead_letter',
        error: 'Stripe unavailable',
      },
    ])

    const result = await getDashboardSubscriptionBillingActions('org-1')

    expect(result.cancellationSync).toEqual({
      operationId: '67e55044-10b1-426f-9247-bb680e5fe0c8',
      timing: 'period_end',
      status: 'failed',
      error: 'Stripe unavailable',
    })
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
    expect(mocks.recordAuditOnce).toHaveBeenCalledWith(
      'admin-refund:67e55044-10b1-426f-9247-bb680e5fe0c8',
      expect.objectContaining({
        action: 'subscription.refunded',
        resourceId: 'sub-row-1',
        metadata: expect.objectContaining({ refundId: 're_existing' }),
      })
    )
  })

  it('repairs a lost audit write on exact refund replay before returning success', async () => {
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
    mocks.recordAuditOnce.mockRejectedValueOnce(new Error('database unavailable'))

    const request = {
      organizationId: 'org-1',
      operationId: '67e55044-10b1-426f-9247-bb680e5fe0c8',
      chargeId: 'ch_1',
      amountCents: 2500,
      reason: 'requested_by_customer' as const,
      actor,
    }
    await expect(refundDashboardSubscriptionPayment(request)).rejects.toThrow(
      'database unavailable'
    )

    mocks.recordAuditOnce.mockResolvedValueOnce(undefined)
    await expect(refundDashboardSubscriptionPayment(request)).resolves.toMatchObject({
      refundId: 're_existing',
      outcome: 'applied',
    })
    expect(mocks.refundsCreate).not.toHaveBeenCalled()
    expect(mocks.recordAuditOnce).toHaveBeenCalledTimes(2)
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
    expect(mocks.recordAuditOnce).not.toHaveBeenCalled()
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
    expect(mocks.recordAuditOnce).not.toHaveBeenCalled()
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
