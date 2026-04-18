import { db } from '@sim/db'
import { subscription as subscriptionTable } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import type Stripe from 'stripe'
import { requireStripeClient } from '@/lib/billing/stripe-client'
import type { OutboxHandler } from '@/lib/core/outbox/service'

const logger = createLogger('BillingOutboxHandlers')

export const OUTBOX_EVENT_TYPES = {
  /**
   * Sync a subscription's `cancel_at_period_end` flag from our DB to
   * Stripe. The handler reads the current DB value at processing time
   * — so rapid cancel→uncancel→cancel sequences always converge on
   * the last-committed DB state regardless of outbox ordering. Callers
   * enqueue this event after every DB change to `cancelAtPeriodEnd`.
   */
  STRIPE_SYNC_CANCEL_AT_PERIOD_END: 'stripe.sync-cancel-at-period-end',
  STRIPE_THRESHOLD_OVERAGE_INVOICE: 'stripe.threshold-overage-invoice',
} as const

export interface StripeSyncCancelAtPeriodEndPayload {
  stripeSubscriptionId: string
  /** The DB subscription row id — also our source-of-truth pointer. */
  subscriptionId: string
  /** Optional: reason this was enqueued — e.g. 'member-joined-paid-org'. */
  reason?: string
}

export interface StripeThresholdOverageInvoicePayload {
  customerId: string
  stripeSubscriptionId: string
  amountCents: number
  description: string
  itemDescription: string
  billingPeriod: string
  /** Stripe idempotency key stem — we append the outbox event id for per-retry safety. */
  invoiceIdemKeyStem: string
  itemIdemKeyStem: string
  metadata?: Record<string, string>
}

const stripeSyncCancelAtPeriodEnd: OutboxHandler<StripeSyncCancelAtPeriodEndPayload> = async (
  payload,
  ctx
) => {
  // Read the DB value at processing time (not at enqueue time). This
  // makes the handler idempotent across racing enqueues: multiple
  // events for the same subscription all push whatever the DB
  // currently says, converging on the last committed value.
  const rows = await db
    .select({ cancelAtPeriodEnd: subscriptionTable.cancelAtPeriodEnd })
    .from(subscriptionTable)
    .where(eq(subscriptionTable.id, payload.subscriptionId))
    .limit(1)

  if (rows.length === 0) {
    logger.warn('Subscription not found when syncing cancel_at_period_end', {
      subscriptionId: payload.subscriptionId,
    })
    return
  }

  const desiredValue = Boolean(rows[0].cancelAtPeriodEnd)
  const stripe = requireStripeClient()
  await stripe.subscriptions.update(
    payload.stripeSubscriptionId,
    { cancel_at_period_end: desiredValue },
    { idempotencyKey: `outbox:${ctx.eventId}` }
  )
  logger.info('Synced cancel_at_period_end from DB to Stripe', {
    eventId: ctx.eventId,
    stripeSubscriptionId: payload.stripeSubscriptionId,
    subscriptionId: payload.subscriptionId,
    desiredValue,
    reason: payload.reason,
  })
}

/**
 * Resolve the payment method to use for auto-collection. Matches the
 * pre-refactor behavior: subscription PM first, customer PM second.
 * Without this, Stripe falls back to customer PM only when the invoice
 * is attached to a subscription — but we create an ad-hoc invoice not
 * linked to the subscription, so we resolve explicitly.
 */
async function resolveDefaultPaymentMethod(
  stripe: Stripe,
  stripeSubscriptionId: string,
  customerId: string
): Promise<string | undefined> {
  const toId = (pm: string | Stripe.PaymentMethod | null | undefined): string | undefined =>
    typeof pm === 'string' ? pm : pm?.id

  try {
    const sub = await stripe.subscriptions.retrieve(stripeSubscriptionId)
    const subPm = toId(sub.default_payment_method)
    if (subPm) return subPm

    const customer = await stripe.customers.retrieve(customerId)
    if (customer && !('deleted' in customer)) {
      return toId((customer as Stripe.Customer).invoice_settings?.default_payment_method)
    }
  } catch (error) {
    logger.warn('Failed to resolve default payment method', {
      stripeSubscriptionId,
      customerId,
      error: error instanceof Error ? error.message : error,
    })
  }

  return undefined
}

const stripeThresholdOverageInvoice: OutboxHandler<StripeThresholdOverageInvoicePayload> = async (
  payload,
  ctx
) => {
  const stripe = requireStripeClient()

  // Resolve default PM from (subscription → customer) so Stripe can
  // auto-collect when the invoice finalizes. Without this, an ad-hoc
  // invoice (no subscription link) falls back to customer-level PM
  // only, which may not be set for customers onboarded via Checkout
  // Subscription flows.
  const defaultPaymentMethod = await resolveDefaultPaymentMethod(
    stripe,
    payload.stripeSubscriptionId,
    payload.customerId
  )

  // Compose Stripe idempotency keys from caller-provided stem + outbox
  // event id so retries of the SAME outbox event collapse on Stripe's
  // side.
  const invoiceIdemKey = `${payload.invoiceIdemKeyStem}:${ctx.eventId}`
  const itemIdemKey = `${payload.itemIdemKeyStem}:${ctx.eventId}`

  // `auto_advance: false` + explicit finalize mirrors pre-refactor
  // behavior: we control exactly when the invoice finalizes, so it
  // doesn't silently convert to paid/open on Stripe's schedule while
  // our retry state is still in flight.
  const invoice = await stripe.invoices.create(
    {
      customer: payload.customerId,
      collection_method: 'charge_automatically',
      auto_advance: false,
      description: payload.description,
      metadata: payload.metadata,
      ...(defaultPaymentMethod ? { default_payment_method: defaultPaymentMethod } : {}),
    },
    { idempotencyKey: invoiceIdemKey }
  )

  if (!invoice.id) {
    throw new Error('Stripe returned invoice without id')
  }

  await stripe.invoiceItems.create(
    {
      customer: payload.customerId,
      invoice: invoice.id,
      amount: payload.amountCents,
      currency: 'usd',
      description: payload.itemDescription,
      metadata: payload.metadata,
    },
    { idempotencyKey: itemIdemKey }
  )

  const finalized = await stripe.invoices.finalizeInvoice(invoice.id)

  // If Stripe didn't auto-charge on finalize (e.g. `open` status with
  // a known PM), attempt payment explicitly. Payment failures are
  // non-fatal to the handler — the invoice is finalized and will
  // retry charging via Stripe's own dunning.
  if (finalized.status === 'open' && finalized.id && defaultPaymentMethod) {
    try {
      await stripe.invoices.pay(finalized.id, { payment_method: defaultPaymentMethod })
    } catch (payError) {
      logger.warn('Auto-pay failed for threshold overage invoice — Stripe dunning will retry', {
        invoiceId: finalized.id,
        error: payError instanceof Error ? payError.message : payError,
      })
    }
  }

  logger.info('Created threshold overage invoice via outbox', {
    eventId: ctx.eventId,
    invoiceId: invoice.id,
    customerId: payload.customerId,
    amountCents: payload.amountCents,
    billingPeriod: payload.billingPeriod,
    defaultPaymentMethod: defaultPaymentMethod ? 'resolved' : 'none',
  })
}

export const billingOutboxHandlers = {
  [OUTBOX_EVENT_TYPES.STRIPE_SYNC_CANCEL_AT_PERIOD_END]:
    stripeSyncCancelAtPeriodEnd as OutboxHandler<unknown>,
  [OUTBOX_EVENT_TYPES.STRIPE_THRESHOLD_OVERAGE_INVOICE]:
    stripeThresholdOverageInvoice as OutboxHandler<unknown>,
} as const
