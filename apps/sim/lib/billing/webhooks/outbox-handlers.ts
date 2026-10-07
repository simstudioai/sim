import { AuditAction, AuditResourceType, recordAuditOnce } from '@sim/audit'
import { db } from '@sim/db'
import { member, subscription as subscriptionTable, user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateShortId } from '@sim/utils/id'
import { and, eq } from 'drizzle-orm'
import { isTeam } from '@/lib/billing/plan-helpers'
import { getPlanByName } from '@/lib/billing/plans'
import { requireStripeClient } from '@/lib/billing/stripe-client'
import { resolveDefaultPaymentMethod } from '@/lib/billing/stripe-payment-method'
import { hasPaidSubscriptionStatus } from '@/lib/billing/subscriptions/utils'
import { OUTBOX_EVENT_TYPES } from '@/lib/billing/webhooks/outbox-events'
import {
  type CancelAtPeriodEndSyncPayload,
  cancelAtPeriodEndSyncIdempotencyKey,
  type SubscriptionSeatsSyncPayload,
} from '@/lib/billing/webhooks/subscription-sync'
import type { OutboxHandler } from '@/lib/core/outbox/service'

const logger = createLogger('BillingOutboxHandlers')

interface StripeCancelSubscriptionImmediatelyPayload {
  stripeSubscriptionId: string
  subscriptionId: string
  organizationId: string
  operationId: string
  reason?: string
  requestedBy: { id: string | null; name: string; email: string | null }
}

async function recordAdminCancellationAudit(params: {
  operationId?: string
  organizationId?: string
  subscriptionId: string
  requestedBy?: { id: string | null; name: string; email: string | null }
  timing: 'period_end' | 'immediate'
  reason?: string
}) {
  if (!params.operationId || !params.organizationId || !params.requestedBy) return
  await recordAuditOnce(`${params.operationId}:cancellation-requested`, {
    actorId: params.requestedBy.id,
    actorName: params.requestedBy.name,
    actorEmail: params.requestedBy.email,
    action: AuditAction.SUBSCRIPTION_CANCELLED,
    resourceType: AuditResourceType.SUBSCRIPTION,
    resourceId: params.subscriptionId,
    description: `Admin requested ${params.timing === 'period_end' ? 'period-end' : 'immediate'} organization subscription cancellation`,
    metadata: {
      organizationId: params.organizationId,
      requestOperationId: params.operationId,
      timing: params.timing,
      reason: params.reason ?? null,
    },
  })
}

interface StripeSyncCustomerContactPayload {
  /** The DB subscription row id — handler resolves current owner/contact at processing time. */
  subscriptionId: string
  reason?: string
}

interface StripeThresholdOverageInvoicePayload {
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

async function getSubscriptionSeatSyncState(subscriptionId: string) {
  const [row] = await db
    .select({
      plan: subscriptionTable.plan,
      seats: subscriptionTable.seats,
      status: subscriptionTable.status,
      stripeSubscriptionId: subscriptionTable.stripeSubscriptionId,
    })
    .from(subscriptionTable)
    .where(eq(subscriptionTable.id, subscriptionId))
    .limit(1)

  return row ?? null
}

async function readCancelAtPeriodEnd(subscriptionId: string): Promise<boolean | null> {
  const [row] = await db
    .select({ cancelAtPeriodEnd: subscriptionTable.cancelAtPeriodEnd })
    .from(subscriptionTable)
    .where(eq(subscriptionTable.id, subscriptionId))
    .limit(1)
  return row ? Boolean(row.cancelAtPeriodEnd) : null
}

/**
 * Pushes the row's current value, never the payload's: racing events for one subscription each
 * converge on the last committed value. Stripe is read first and written only when it differs,
 * and the row is re-read after the write so a value committed while this event's request was in
 * flight is pushed too, even when an earlier event's request lands in Stripe after a newer one.
 */
const stripeSyncCancelAtPeriodEnd: OutboxHandler<CancelAtPeriodEndSyncPayload> = async (
  payload,
  ctx
) => {
  await recordAdminCancellationAudit({ ...payload, timing: 'period_end' })
  const stripe = requireStripeClient()
  const maxSyncAttempts = 2

  for (let attempt = 1; attempt <= maxSyncAttempts; attempt++) {
    const desiredValue = await readCancelAtPeriodEnd(payload.subscriptionId)
    if (desiredValue === null) {
      logger.warn('Subscription not found when syncing cancel_at_period_end', {
        eventId: ctx.eventId,
        subscriptionId: payload.subscriptionId,
      })
      return
    }

    const stripeSubscription = await stripe.subscriptions.retrieve(payload.stripeSubscriptionId)
    const needsUpdate = stripeSubscription.cancel_at_period_end !== desiredValue
    if (needsUpdate) {
      await stripe.subscriptions.update(
        payload.stripeSubscriptionId,
        { cancel_at_period_end: desiredValue },
        { idempotencyKey: cancelAtPeriodEndSyncIdempotencyKey(ctx.eventId) }
      )
    }

    const latestValue = await readCancelAtPeriodEnd(payload.subscriptionId)
    if (latestValue !== desiredValue) {
      logger.info('cancel_at_period_end changed during Stripe sync; retrying latest value', {
        eventId: ctx.eventId,
        subscriptionId: payload.subscriptionId,
        stripeSubscriptionId: payload.stripeSubscriptionId,
        attemptedValue: desiredValue,
        latestValue,
        attempt,
      })
      continue
    }

    logger.info('Synced cancel_at_period_end from DB to Stripe', {
      eventId: ctx.eventId,
      stripeSubscriptionId: payload.stripeSubscriptionId,
      subscriptionId: payload.subscriptionId,
      desiredValue,
      alreadySynced: !needsUpdate,
      reason: payload.reason,
    })
    return
  }

  throw new Error(`cancel_at_period_end changed while syncing ${payload.subscriptionId}`)
}

const stripeCancelSubscriptionImmediately: OutboxHandler<
  StripeCancelSubscriptionImmediatelyPayload
> = async (payload, ctx) => {
  await recordAdminCancellationAudit({ ...payload, timing: 'immediate' })
  const stripe = requireStripeClient()
  await stripe.subscriptions.cancel(
    payload.stripeSubscriptionId,
    { prorate: true, invoice_now: true },
    { idempotencyKey: `outbox:${ctx.eventId}` }
  )
  logger.info('Cancelled subscription immediately in Stripe; awaiting verified webhook cleanup', {
    eventId: ctx.eventId,
    organizationId: payload.organizationId,
    subscriptionId: payload.subscriptionId,
    stripeSubscriptionId: payload.stripeSubscriptionId,
    operationId: payload.operationId,
    reason: payload.reason,
  })
}

const stripeSyncSubscriptionSeats: OutboxHandler<SubscriptionSeatsSyncPayload> = async (
  payload,
  ctx
) => {
  const stripe = requireStripeClient()
  const maxSyncAttempts = 2

  for (let attempt = 1; attempt <= maxSyncAttempts; attempt++) {
    const row = await getSubscriptionSeatSyncState(payload.subscriptionId)
    if (!row) {
      logger.warn('Subscription not found when syncing seats', {
        eventId: ctx.eventId,
        subscriptionId: payload.subscriptionId,
      })
      return
    }

    if (!isTeam(row.plan)) {
      logger.info('Skipping seat sync for non-Team subscription', {
        eventId: ctx.eventId,
        subscriptionId: payload.subscriptionId,
        plan: row.plan,
      })
      return
    }

    if (!row.stripeSubscriptionId) {
      logger.warn('Subscription has no Stripe id when syncing seats', {
        eventId: ctx.eventId,
        subscriptionId: payload.subscriptionId,
      })
      return
    }

    if (!hasPaidSubscriptionStatus(row.status)) {
      logger.warn('Skipping seat sync for non-entitled DB subscription status', {
        eventId: ctx.eventId,
        subscriptionId: payload.subscriptionId,
        status: row.status,
      })
      return
    }

    const desiredSeats = row.seats || 1
    const stripeSubscription = await stripe.subscriptions.retrieve(row.stripeSubscriptionId)

    if (!hasPaidSubscriptionStatus(stripeSubscription.status)) {
      logger.warn('Skipping seat sync for non-entitled Stripe subscription', {
        eventId: ctx.eventId,
        subscriptionId: payload.subscriptionId,
        stripeSubscriptionId: row.stripeSubscriptionId,
        stripeStatus: stripeSubscription.status,
      })
      return
    }

    const subscriptionItem = stripeSubscription.items.data[0]
    if (!subscriptionItem) {
      throw new Error(
        `No subscription item found for Stripe subscription ${row.stripeSubscriptionId}`
      )
    }

    // Reconcile the price too: a Pro→Team conversion moves the DB plan to a
    // Team tier while Stripe is still on the Pro price. Resolve the target
    // price for the DB plan at the item's current interval. If the target
    // price is unconfigured we leave the price untouched and sync quantity
    // only — `mapToTeamPlanName` guards conversions against missing tiers.
    const targetPlan = getPlanByName(row.plan)
    const interval = subscriptionItem.price?.recurring?.interval
    const targetPriceId =
      interval === 'year' ? targetPlan?.annualDiscountPriceId : targetPlan?.priceId
    const priceNeedsChange = Boolean(targetPriceId) && subscriptionItem.price?.id !== targetPriceId
    const quantityNeedsChange = subscriptionItem.quantity !== desiredSeats

    if (priceNeedsChange || quantityNeedsChange) {
      await stripe.subscriptions.update(
        row.stripeSubscriptionId,
        {
          items: [
            {
              id: subscriptionItem.id,
              quantity: desiredSeats,
              ...(priceNeedsChange ? { price: targetPriceId } : {}),
            },
          ],
          proration_behavior: 'always_invoice',
        },
        { idempotencyKey: `outbox:${ctx.eventId}:${row.plan}:${desiredSeats}` }
      )
    }

    const latest = await getSubscriptionSeatSyncState(payload.subscriptionId)
    const latestSeats = latest?.seats || 1
    if (latestSeats !== desiredSeats) {
      logger.info('Subscription seats changed during Stripe sync; retrying latest value', {
        eventId: ctx.eventId,
        subscriptionId: payload.subscriptionId,
        stripeSubscriptionId: row.stripeSubscriptionId,
        attemptedSeats: desiredSeats,
        latestSeats,
        attempt,
      })
      continue
    }

    logger.info('Synced subscription price and seats from DB to Stripe', {
      eventId: ctx.eventId,
      subscriptionId: payload.subscriptionId,
      stripeSubscriptionId: row.stripeSubscriptionId,
      plan: row.plan,
      seats: desiredSeats,
      alreadySynced: !priceNeedsChange && !quantityNeedsChange,
      reason: payload.reason,
    })
    return
  }

  throw new Error(`Subscription seats changed while syncing ${payload.subscriptionId}`)
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
        error: getErrorMessage(payError),
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

type CustomerContactState =
  | { status: 'ready'; stripeCustomerId: string; email: string; name: string }
  | { status: 'skipped'; reason: string; organizationId?: string }

async function readCustomerContact(subscriptionId: string): Promise<CustomerContactState> {
  const [subscriptionRow] = await db
    .select({
      referenceId: subscriptionTable.referenceId,
      stripeCustomerId: subscriptionTable.stripeCustomerId,
    })
    .from(subscriptionTable)
    .where(eq(subscriptionTable.id, subscriptionId))
    .limit(1)

  if (!subscriptionRow) {
    return {
      status: 'skipped',
      reason: 'Subscription not found when syncing Stripe customer contact',
    }
  }
  if (!subscriptionRow.stripeCustomerId) {
    return {
      status: 'skipped',
      reason: 'Subscription has no Stripe customer id when syncing contact',
    }
  }

  const [owner] = await db
    .select({
      email: user.email,
      name: user.name,
    })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(and(eq(member.organizationId, subscriptionRow.referenceId), eq(member.role, 'owner')))
    .limit(1)

  if (!owner) {
    return {
      status: 'skipped',
      reason: 'Organization owner not found when syncing Stripe customer contact',
      organizationId: subscriptionRow.referenceId,
    }
  }

  return {
    status: 'ready',
    stripeCustomerId: subscriptionRow.stripeCustomerId,
    email: owner.email,
    name: owner.name,
  }
}

/**
 * Pushes the organization owner's current contact, re-reading it after the write so an
 * ownership change committed while this event's request was in flight is pushed too.
 */
const stripeSyncCustomerContact: OutboxHandler<StripeSyncCustomerContactPayload> = async (
  payload,
  ctx
) => {
  const stripe = requireStripeClient()
  const maxSyncAttempts = 2

  for (let attempt = 1; attempt <= maxSyncAttempts; attempt++) {
    const contact = await readCustomerContact(payload.subscriptionId)
    if (contact.status === 'skipped') {
      logger.warn(contact.reason, {
        eventId: ctx.eventId,
        subscriptionId: payload.subscriptionId,
        ...(contact.organizationId ? { organizationId: contact.organizationId } : {}),
      })
      return
    }

    const customer = await stripe.customers.retrieve(contact.stripeCustomerId)
    if (customer.deleted) {
      throw new Error(`Stripe customer ${contact.stripeCustomerId} is deleted`)
    }
    const needsUpdate =
      customer.email !== contact.email || Boolean(contact.name && customer.name !== contact.name)
    if (needsUpdate) {
      await stripe.customers.update(
        contact.stripeCustomerId,
        {
          email: contact.email,
          ...(contact.name ? { name: contact.name } : {}),
        },
        { idempotencyKey: `outbox:${ctx.eventId}:${generateShortId()}` }
      )
    }

    const latest = await readCustomerContact(payload.subscriptionId)
    if (
      latest.status !== 'ready' ||
      latest.stripeCustomerId !== contact.stripeCustomerId ||
      latest.email !== contact.email ||
      latest.name !== contact.name
    ) {
      logger.info('Stripe customer contact changed during sync; retrying latest value', {
        eventId: ctx.eventId,
        subscriptionId: payload.subscriptionId,
        attempt,
      })
      continue
    }

    logger.info('Synced Stripe customer contact', {
      eventId: ctx.eventId,
      stripeCustomerId: contact.stripeCustomerId,
      subscriptionId: payload.subscriptionId,
      alreadySynced: !needsUpdate,
      reason: payload.reason,
    })
    return
  }

  throw new Error(`Stripe customer contact changed while syncing ${payload.subscriptionId}`)
}

export const billingOutboxHandlers = {
  [OUTBOX_EVENT_TYPES.STRIPE_SYNC_CANCEL_AT_PERIOD_END]:
    stripeSyncCancelAtPeriodEnd as OutboxHandler<unknown>,
  [OUTBOX_EVENT_TYPES.STRIPE_CANCEL_SUBSCRIPTION_IMMEDIATELY]:
    stripeCancelSubscriptionImmediately as OutboxHandler<unknown>,
  [OUTBOX_EVENT_TYPES.STRIPE_SYNC_SUBSCRIPTION_SEATS]:
    stripeSyncSubscriptionSeats as OutboxHandler<unknown>,
  [OUTBOX_EVENT_TYPES.STRIPE_THRESHOLD_OVERAGE_INVOICE]:
    stripeThresholdOverageInvoice as OutboxHandler<unknown>,
  [OUTBOX_EVENT_TYPES.STRIPE_SYNC_CUSTOMER_CONTACT]:
    stripeSyncCustomerContact as OutboxHandler<unknown>,
} as const
