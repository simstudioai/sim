export const OUTBOX_EVENT_TYPES = {
  /**
   * Sync a subscription's `cancel_at_period_end` flag from our DB to
   * Stripe. The handler reads the current DB value at processing time
   * — so rapid cancel→uncancel→cancel sequences always converge on
   * the last-committed DB state regardless of outbox ordering. Callers
   * enqueue this event after every DB change to `cancelAtPeriodEnd`.
   */
  STRIPE_SYNC_CANCEL_AT_PERIOD_END: 'stripe.sync-cancel-at-period-end',
  /** Cancel in Stripe; the verified deletion webhook remains the only DB entitlement authority. */
  STRIPE_CANCEL_SUBSCRIPTION_IMMEDIATELY: 'stripe.cancel-subscription-immediately',
  /**
   * Sync a Team subscription's price and seat quantity from our DB to
   * Stripe. The handler reads the current DB plan + seats at processing
   * time and reconciles the Stripe item's price (e.g. after a Pro→Team
   * conversion) and quantity, charging the proration via `always_invoice`.
   * A failed charge surfaces through Stripe dunning and the existing
   * billing-blocked system, never under the synchronous accept path.
   */
  STRIPE_SYNC_SUBSCRIPTION_SEATS: 'stripe.sync-subscription-seats',
  STRIPE_THRESHOLD_OVERAGE_INVOICE: 'stripe.threshold-overage-invoice',
  STRIPE_SYNC_CUSTOMER_CONTACT: 'stripe.sync-customer-contact',
} as const
