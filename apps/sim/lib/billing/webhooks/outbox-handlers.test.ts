/**
 * @vitest-environment node
 */
import { queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetPlanByName, mockResolveDefaultPaymentMethod, stripeMock } = vi.hoisted(() => {
  const stripeMock = {
    invoiceItems: {
      create: vi.fn(),
    },
    invoices: {
      create: vi.fn(),
      finalizeInvoice: vi.fn(),
      pay: vi.fn(),
      retrieve: vi.fn(),
      update: vi.fn(),
    },
    subscriptions: {
      retrieve: vi.fn(),
      update: vi.fn(),
    },
  }
  return {
    mockGetPlanByName: vi.fn(),
    mockResolveDefaultPaymentMethod: vi.fn(),
    stripeMock,
  }
})

vi.mock('@/lib/billing/stripe-client', () => ({
  requireStripeClient: () => stripeMock,
}))

vi.mock('@/lib/billing/plans', () => ({
  getPlanByName: mockGetPlanByName,
}))

vi.mock('@/lib/billing/stripe-payment-method', () => ({
  resolveDefaultPaymentMethod: mockResolveDefaultPaymentMethod,
}))

import { billingOutboxHandlers, OUTBOX_EVENT_TYPES } from '@/lib/billing/webhooks/outbox-handlers'

const seatSyncHandler = billingOutboxHandlers[OUTBOX_EVENT_TYPES.STRIPE_SYNC_SUBSCRIPTION_SEATS]
const thresholdInvoiceHandler =
  billingOutboxHandlers[OUTBOX_EVENT_TYPES.STRIPE_THRESHOLD_OVERAGE_INVOICE]

const ctx = {
  eventId: 'evt-1',
  eventType: OUTBOX_EVENT_TYPES.STRIPE_SYNC_SUBSCRIPTION_SEATS,
  attempts: 0,
}

function stripeItem(overrides: {
  quantity?: number
  priceId?: string
  interval?: 'month' | 'year'
  status?: 'active' | 'past_due'
}) {
  return {
    status: overrides.status ?? 'active',
    items: {
      data: [
        {
          id: 'si_1',
          quantity: overrides.quantity ?? 1,
          price: {
            id: overrides.priceId ?? 'price_pro_month',
            recurring: { interval: overrides.interval ?? 'month' },
          },
        },
      ],
    },
  }
}

/** Queues the handler's pre-Stripe and re-verification subscription reads. */
function queueSubscriptionReads(rowSets: unknown[][]) {
  for (const rows of rowSets) {
    queueTableRows(schemaMock.subscription, rows)
  }
}

describe('stripeSyncSubscriptionSeats outbox handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockGetPlanByName.mockReturnValue({
      priceId: 'price_team_month',
      annualDiscountPriceId: 'price_team_year',
    })
    stripeMock.subscriptions.update.mockResolvedValue({})
  })

  afterAll(() => {
    resetDbChainMock()
  })

  it('reconciles both price and quantity for a Pro→Team conversion', async () => {
    const row = {
      plan: 'team_6000',
      seats: 2,
      status: 'active',
      stripeSubscriptionId: 'stripe_sub',
    }
    queueSubscriptionReads([[row], [row]])
    stripeMock.subscriptions.retrieve.mockResolvedValue(
      stripeItem({ quantity: 1, priceId: 'price_pro_month' })
    )

    await seatSyncHandler({ subscriptionId: 'sub-1' }, ctx)

    expect(stripeMock.subscriptions.update).toHaveBeenCalledWith(
      'stripe_sub',
      expect.objectContaining({
        items: [{ id: 'si_1', quantity: 2, price: 'price_team_month' }],
        proration_behavior: 'always_invoice',
      }),
      expect.any(Object)
    )
  })

  it('syncs seats while both DB and Stripe subscriptions are past due', async () => {
    const row = {
      plan: 'team_6000',
      seats: 2,
      status: 'past_due',
      stripeSubscriptionId: 'stripe_sub',
    }
    queueSubscriptionReads([[row], [row]])
    stripeMock.subscriptions.retrieve.mockResolvedValue(
      stripeItem({ quantity: 1, priceId: 'price_team_month', status: 'past_due' })
    )

    await seatSyncHandler({ subscriptionId: 'sub-1' }, ctx)

    expect(stripeMock.subscriptions.update).toHaveBeenCalledWith(
      'stripe_sub',
      expect.objectContaining({ items: [{ id: 'si_1', quantity: 2 }] }),
      expect.any(Object)
    )
  })

  it('uses the annual price when the subscription bills yearly', async () => {
    const row = {
      plan: 'team_6000',
      seats: 2,
      status: 'active',
      stripeSubscriptionId: 'stripe_sub',
    }
    queueSubscriptionReads([[row], [row]])
    stripeMock.subscriptions.retrieve.mockResolvedValue(
      stripeItem({ quantity: 1, priceId: 'price_pro_year', interval: 'year' })
    )

    await seatSyncHandler({ subscriptionId: 'sub-1' }, ctx)

    expect(stripeMock.subscriptions.update).toHaveBeenCalledWith(
      'stripe_sub',
      expect.objectContaining({
        items: [{ id: 'si_1', quantity: 2, price: 'price_team_year' }],
      }),
      expect.any(Object)
    )
  })

  it('adjusts quantity only when the price already matches', async () => {
    const row = {
      plan: 'team_6000',
      seats: 3,
      status: 'active',
      stripeSubscriptionId: 'stripe_sub',
    }
    queueSubscriptionReads([[row], [row]])
    stripeMock.subscriptions.retrieve.mockResolvedValue(
      stripeItem({ quantity: 2, priceId: 'price_team_month' })
    )

    await seatSyncHandler({ subscriptionId: 'sub-1' }, ctx)

    const updateArg = stripeMock.subscriptions.update.mock.calls[0][1] as {
      items: Array<{ price?: string; quantity: number }>
    }
    expect(updateArg.items[0].quantity).toBe(3)
    expect(updateArg.items[0].price).toBeUndefined()
  })

  it('does nothing when price and quantity are already in sync', async () => {
    const row = {
      plan: 'team_6000',
      seats: 2,
      status: 'active',
      stripeSubscriptionId: 'stripe_sub',
    }
    queueSubscriptionReads([[row], [row]])
    stripeMock.subscriptions.retrieve.mockResolvedValue(
      stripeItem({ quantity: 2, priceId: 'price_team_month' })
    )

    await seatSyncHandler({ subscriptionId: 'sub-1' }, ctx)

    expect(stripeMock.subscriptions.update).not.toHaveBeenCalled()
  })

  it('skips non-Team subscriptions', async () => {
    queueSubscriptionReads([
      [{ plan: 'pro_6000', seats: 1, status: 'active', stripeSubscriptionId: 's' }],
    ])

    await seatSyncHandler({ subscriptionId: 'sub-1' }, ctx)

    expect(stripeMock.subscriptions.retrieve).not.toHaveBeenCalled()
    expect(stripeMock.subscriptions.update).not.toHaveBeenCalled()
  })
})

describe('stripeThresholdOverageInvoice outbox handler', () => {
  const payload = {
    customerId: 'cus-1',
    stripeSubscriptionId: 'sub-1',
    amountCents: 20_000,
    description: 'Usage threshold reached',
    itemDescription: 'Usage overage',
    billingPeriod: '2026-08',
    invoiceIdemKeyStem: 'invoice-stem',
    itemIdemKeyStem: 'item-stem',
    metadata: { type: 'overage_threshold_billing' },
  }
  const thresholdCtx = {
    ...ctx,
    eventType: OUTBOX_EVENT_TYPES.STRIPE_THRESHOLD_OVERAGE_INVOICE,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockResolveDefaultPaymentMethod.mockResolvedValue({ paymentMethodId: 'pm-1' })
    stripeMock.invoices.create.mockResolvedValue({ id: 'in-1' })
    stripeMock.invoices.finalizeInvoice.mockResolvedValue({ id: 'in-1', status: 'open' })
    stripeMock.invoices.pay.mockResolvedValue({ id: 'in-1', status: 'paid' })
    stripeMock.invoices.retrieve.mockResolvedValue({
      custom_fields: [],
      id: 'in-1',
      status: 'draft',
    })
    stripeMock.invoices.update.mockResolvedValue({ id: 'in-1' })
    stripeMock.invoiceItems.create.mockResolvedValue({ id: 'ii-1' })
  })

  it('adds the queued credit summary to the Stripe invoice', async () => {
    await thresholdInvoiceHandler(
      {
        ...payload,
        creditSummary: {
          type: 'usage_charge',
          creditsUsed: 50_000,
          prepaidCreditsApplied: 10_000,
          creditsBilled: 40_000,
        },
      },
      thresholdCtx
    )

    const invoiceParams = stripeMock.invoices.create.mock.calls[0][0]
    expect(invoiceParams).not.toHaveProperty('custom_fields')
    expect(stripeMock.invoices.update).toHaveBeenCalledWith(
      'in-1',
      {
        custom_fields: [
          {
            name: 'Credit usage',
            value: '50,000 used; 10,000 prepaid; 40,000 billed',
          },
        ],
      },
      {
        idempotencyKey: 'invoice-credit-summary:in-1:usage_charge:50000:10000:40000',
      }
    )
  })

  it('continues processing legacy queued events without a credit summary', async () => {
    await thresholdInvoiceHandler(payload, thresholdCtx)

    const invoiceParams = stripeMock.invoices.create.mock.calls[0][0]
    expect(invoiceParams).not.toHaveProperty('custom_fields')
    expect(stripeMock.invoices.retrieve).not.toHaveBeenCalled()
    expect(stripeMock.invoices.update).not.toHaveBeenCalled()
  })
})
