import { db } from '@sim/db'
import { subscription as subscriptionTable } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { requireStripeClient } from '@/lib/billing/stripe-client'
import { resolveDefaultPaymentMethod } from '@/lib/billing/stripe-payment-method'
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
  STRIPE_SYNC_CUSTOMER_CONTACT: 'stripe.sync-customer-contact',
} as const

export interface StripeSyncCancelAtPeriodEndPayload {
  stripeSubscriptionId: string
  /** The DB subscription row id — also our source-of-truth pointer. */
  subscriptionId: string
  /** Optional: reason this was enqueued — e.g. 'member-joined-paid-org'. */
  reason?: string
}

export interface StripeSyncCustomerContactPayload {
  stripeCustomerId: string
  email: string
  name?: string
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
  const { paymentMethodId: defaultPaymentMethod } = await resolveDefaultPaymentMethod(
    stripe,
    payload.stripeSubscriptionId,
    payload.customerId
  )

  // Compose Stripe idempotency keys from caller-provided stem + outbox
  // event id so retries of the SAME outbox event collapse on Stripe's
  // side.
  const invoiceIdemKey = `${payload.invoiceIdemKeyStem}:${ctx.eventId}`
  const itemIdemKey = `${payload.itemIdemKeyStem}:${ctx.eventId}`
  const finalizeIdemKey = `${payload.invoiceIdemKeyStem}:finalize:${ctx.eventId}`
  const payIdemKey = `${payload.invoiceIdemKeyStem}:pay:${ctx.eventId}`

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

  const finalized = await stripe.invoices.finalizeInvoice(
    invoice.id,
    {},
    { idempotencyKey: finalizeIdemKey }
  )

  if (finalized.status === 'open' && finalized.id && defaultPaymentMethod) {
    try {
      await stripe.invoices.pay(
        finalized.id,
        { payment_method: defaultPaymentMethod },
        { idempotencyKey: payIdemKey }
      )
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

const stripeSyncCustomerContact: OutboxHandler<StripeSyncCustomerContactPayload> = async (
  payload,
  ctx
) => {
  const stripe = requireStripeClient()
  await stripe.customers.update(
    payload.stripeCustomerId,
    {
      email: payload.email,
      ...(payload.name ? { name: payload.name } : {}),
    },
    { idempotencyKey: `outbox:${ctx.eventId}` }
  )
  logger.info('Synced Stripe customer contact', {
    eventId: ctx.eventId,
    stripeCustomerId: payload.stripeCustomerId,
    reason: payload.reason,
  })
}

export const billingOutboxHandlers = {
  [OUTBOX_EVENT_TYPES.STRIPE_SYNC_CANCEL_AT_PERIOD_END]:
    stripeSyncCancelAtPeriodEnd as OutboxHandler<unknown>,
  [OUTBOX_EVENT_TYPES.STRIPE_THRESHOLD_OVERAGE_INVOICE]:
    stripeThresholdOverageInvoice as OutboxHandler<unknown>,
  [OUTBOX_EVENT_TYPES.STRIPE_SYNC_CUSTOMER_CONTACT]:
    stripeSyncCustomerContact as OutboxHandler<unknown>,
} as const
