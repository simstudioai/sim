/**
 * @vitest-environment node
 */
import { queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetPlanByName, mockRecordAuditOnce, mockResolveDefaultPaymentMethod, stripeMock } =
  vi.hoisted(() => {
    const stripeMock = {
      subscriptions: {
        cancel: vi.fn(),
        retrieve: vi.fn(),
        update: vi.fn(),
      },
    }
    return {
      mockGetPlanByName: vi.fn(),
      mockRecordAuditOnce: vi.fn(),
      mockResolveDefaultPaymentMethod: vi.fn(),
      stripeMock,
    }
  })

vi.mock('@sim/audit', () => ({
  AuditAction: { SUBSCRIPTION_CANCELLED: 'subscription.cancelled' },
  AuditResourceType: { SUBSCRIPTION: 'subscription' },
  recordAuditOnce: mockRecordAuditOnce,
}))

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
const immediateCancellationHandler =
  billingOutboxHandlers[OUTBOX_EVENT_TYPES.STRIPE_CANCEL_SUBSCRIPTION_IMMEDIATELY]

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

describe('stripeCancelSubscriptionImmediately outbox handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    stripeMock.subscriptions.cancel.mockResolvedValue({ id: 'stripe_sub', status: 'canceled' })
  })

  it('uses the durable event id for Stripe idempotency and leaves Sim cleanup to the webhook', async () => {
    await immediateCancellationHandler(
      {
        stripeSubscriptionId: 'stripe_sub',
        subscriptionId: 'sub-1',
        organizationId: 'org-1',
        operationId: '67e55044-10b1-426f-9247-bb680e5fe0c8',
        requestedBy: { id: 'admin-1', name: 'Admin', email: 'admin@sim.ai' },
      },
      {
        eventId: 'cancel-event-1',
        eventType: OUTBOX_EVENT_TYPES.STRIPE_CANCEL_SUBSCRIPTION_IMMEDIATELY,
        attempts: 0,
      }
    )

    expect(stripeMock.subscriptions.cancel).toHaveBeenCalledWith(
      'stripe_sub',
      { prorate: true, invoice_now: true },
      { idempotencyKey: 'outbox:cancel-event-1' }
    )
  })
})
