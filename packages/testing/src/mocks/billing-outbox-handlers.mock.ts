import { vi } from 'vitest'

/**
 * Real `OUTBOX_EVENT_TYPES` values from `@/lib/billing/webhooks/outbox-handlers`.
 */
const OUTBOX_EVENT_TYPES = {
  STRIPE_SYNC_CANCEL_AT_PERIOD_END: 'stripe.sync-cancel-at-period-end',
  STRIPE_CANCEL_SUBSCRIPTION_IMMEDIATELY: 'stripe.cancel-subscription-immediately',
  STRIPE_SYNC_SUBSCRIPTION_SEATS: 'stripe.sync-subscription-seats',
  STRIPE_THRESHOLD_OVERAGE_INVOICE: 'stripe.threshold-overage-invoice',
  STRIPE_SYNC_CUSTOMER_CONTACT: 'stripe.sync-customer-contact',
} as const

/**
 * Controllable mock functions for `@/lib/billing/webhooks/outbox-handlers`: one bare `vi.fn()`
 * per registered billing outbox handler, keyed by the handler's event type in
 * {@link billingOutboxHandlersMock}.
 *
 * @example
 * ```ts
 * import { billingOutboxHandlersMockFns } from '@sim/testing/mocks/billing-outbox-handlers.mock'
 *
 * expect(billingOutboxHandlersMockFns.mockStripeSyncSubscriptionSeats).toHaveBeenCalled()
 * ```
 */
export const billingOutboxHandlersMockFns = {
  mockStripeSyncCancelAtPeriodEnd: vi.fn(),
  mockStripeCancelSubscriptionImmediately: vi.fn(),
  mockStripeSyncSubscriptionSeats: vi.fn(),
  mockStripeThresholdOverageInvoice: vi.fn(),
  mockStripeSyncCustomerContact: vi.fn(),
}

/**
 * Static mock module for `@/lib/billing/webhooks/outbox-handlers`. `OUTBOX_EVENT_TYPES` carries
 * the real values; `billingOutboxHandlers` maps every event type to its mock handler.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/billing/webhooks/outbox-handlers', () => billingOutboxHandlersMock)
 * ```
 */
export const billingOutboxHandlersMock = {
  OUTBOX_EVENT_TYPES,
  billingOutboxHandlers: {
    [OUTBOX_EVENT_TYPES.STRIPE_SYNC_CANCEL_AT_PERIOD_END]:
      billingOutboxHandlersMockFns.mockStripeSyncCancelAtPeriodEnd,
    [OUTBOX_EVENT_TYPES.STRIPE_CANCEL_SUBSCRIPTION_IMMEDIATELY]:
      billingOutboxHandlersMockFns.mockStripeCancelSubscriptionImmediately,
    [OUTBOX_EVENT_TYPES.STRIPE_SYNC_SUBSCRIPTION_SEATS]:
      billingOutboxHandlersMockFns.mockStripeSyncSubscriptionSeats,
    [OUTBOX_EVENT_TYPES.STRIPE_THRESHOLD_OVERAGE_INVOICE]:
      billingOutboxHandlersMockFns.mockStripeThresholdOverageInvoice,
    [OUTBOX_EVENT_TYPES.STRIPE_SYNC_CUSTOMER_CONTACT]:
      billingOutboxHandlersMockFns.mockStripeSyncCustomerContact,
  },
}
