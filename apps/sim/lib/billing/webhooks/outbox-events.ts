export const OUTBOX_EVENT_TYPES = {
  /**
   * Sync a subscription's `cancel_at_period_end` flag from our DB to
   * Stripe. Enqueue through `enqueueCancelAtPeriodEndSync` in the same
   * transaction as every DB change to `cancelAtPeriodEnd`.
   *
   * Guarantee: once every in-flight event for a subscription completes,
   * Stripe holds the last value committed to the DB. Each handler pushes
   * the row's current value (not its payload's) and re-reads the row
   * after its Stripe write, retrying while the value moved, so racing
   * events converge even when an earlier request lands in Stripe last.
   * While an event is in flight, `reconcileSubscriptionSyncFromStripe`
   * keeps webhook echoes and stale snapshots from overwriting the
   * committed value; a change made in Stripe itself wins over it.
   */
  STRIPE_SYNC_CANCEL_AT_PERIOD_END: 'stripe.sync-cancel-at-period-end',
  /** Cancel in Stripe; the verified deletion webhook remains the only DB entitlement authority. */
  STRIPE_CANCEL_SUBSCRIPTION_IMMEDIATELY: 'stripe.cancel-subscription-immediately',
  /**
   * Sync a Team subscription's price and seat quantity from our DB to
   * Stripe. Enqueue through `enqueueSubscriptionSeatsSync`. The handler
   * reads the current DB plan + seats at processing time and reconciles
   * the Stripe item's price (e.g. after a Pro→Team conversion) and
   * quantity, charging the proration via `always_invoice`.
   * A failed charge surfaces through Stripe dunning and the existing
   * billing-blocked system, never under the synchronous accept path.
   */
  STRIPE_SYNC_SUBSCRIPTION_SEATS: 'stripe.sync-subscription-seats',
  STRIPE_THRESHOLD_OVERAGE_INVOICE: 'stripe.threshold-overage-invoice',
  STRIPE_SYNC_CUSTOMER_CONTACT: 'stripe.sync-customer-contact',
} as const
