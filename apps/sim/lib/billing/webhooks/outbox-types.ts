export const OUTBOX_EVENT_TYPES = {
  /**
   * Sync a subscription's `cancel_at_period_end` flag from our DB to
   * Stripe. The handler reads the current DB value at processing time
   * so rapid cancel/uncancel/cancel sequences converge on the last commit.
   */
  STRIPE_SYNC_CANCEL_AT_PERIOD_END: 'stripe.sync-cancel-at-period-end',
  STRIPE_SYNC_SUBSCRIPTION_SEATS: 'stripe.sync-subscription-seats',
  STRIPE_THRESHOLD_OVERAGE_INVOICE: 'stripe.threshold-overage-invoice',
  STRIPE_SYNC_CUSTOMER_CONTACT: 'stripe.sync-customer-contact',
  BILLING_THRESHOLD_CHECK: 'billing.threshold-check',
} as const
