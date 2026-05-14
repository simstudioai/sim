import { db } from '@sim/db'
import {
  billingClaim,
  member,
  organization,
  subscription as subscriptionTable,
  user,
  userStats,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { BILLING_CLAIM_INVOICE_WRITEABLE_STATUSES } from '@/lib/billing/claims/status'
import { isTeam } from '@/lib/billing/plan-helpers'
import { requireStripeClient } from '@/lib/billing/stripe-client'
import { resolveDefaultPaymentMethod } from '@/lib/billing/stripe-payment-method'
import { hasUsableSubscriptionStatus } from '@/lib/billing/subscriptions/utils'
import {
  type BillingThresholdCheckPayload,
  checkAndBillOverageThreshold,
} from '@/lib/billing/threshold-billing'
import { OUTBOX_EVENT_TYPES } from '@/lib/billing/webhooks/outbox-types'
import { enqueueOutboxEvent, type OutboxHandler } from '@/lib/core/outbox/service'

const logger = createLogger('BillingOutboxHandlers')
const MAX_OVERAGE_INVOICE_RECOVERY_ATTEMPTS = 3

export { OUTBOX_EVENT_TYPES } from '@/lib/billing/webhooks/outbox-types'

interface StripeSyncCancelAtPeriodEndPayload {
  stripeSubscriptionId: string
  /** The DB subscription row id — also our source-of-truth pointer. */
  subscriptionId: string
  /** Optional: reason this was enqueued — e.g. 'member-joined-paid-org'. */
  reason?: string
}

interface StripeSyncSubscriptionSeatsPayload {
  /** The DB subscription row id — the handler reads current seats from this row. */
  subscriptionId: string
  reason?: string
}

interface StripeSyncCustomerContactPayload {
  /** The DB subscription row id — handler resolves current owner/contact at processing time. */
  subscriptionId: string
  reason?: string
}

interface StripeThresholdOverageInvoicePayload {
  claimId?: string
  customerId: string
  stripeSubscriptionId: string
  amountCents: number
  description: string
  itemDescription: string
  billingPeriod: string
  /** Stripe idempotency key stem — claim-backed payloads use claimId for durable retry safety. */
  invoiceIdemKeyStem: string
  itemIdemKeyStem: string
  metadata?: Record<string, string>
}

function getInvoiceRecoveryAttemptCount(metadata: unknown): number {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return 0
  }
  const value = (metadata as Record<string, unknown>).invoiceRecoveryAttemptCount
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
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

const stripeSyncSubscriptionSeats: OutboxHandler<StripeSyncSubscriptionSeatsPayload> = async (
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

    if (!hasUsableSubscriptionStatus(row.status)) {
      logger.warn('Skipping seat sync for unusable DB subscription status', {
        eventId: ctx.eventId,
        subscriptionId: payload.subscriptionId,
        status: row.status,
      })
      return
    }

    const desiredSeats = row.seats || 1
    const stripeSubscription = await stripe.subscriptions.retrieve(row.stripeSubscriptionId)

    if (!hasUsableSubscriptionStatus(stripeSubscription.status)) {
      logger.warn('Skipping seat sync for unusable Stripe subscription', {
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

    if (subscriptionItem.quantity !== desiredSeats) {
      await stripe.subscriptions.update(
        row.stripeSubscriptionId,
        {
          items: [
            {
              id: subscriptionItem.id,
              quantity: desiredSeats,
            },
          ],
          proration_behavior: 'always_invoice',
        },
        { idempotencyKey: `outbox:${ctx.eventId}:seats:${desiredSeats}` }
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

    logger.info('Synced subscription seats from DB to Stripe', {
      eventId: ctx.eventId,
      subscriptionId: payload.subscriptionId,
      stripeSubscriptionId: row.stripeSubscriptionId,
      seats: desiredSeats,
      alreadySynced: subscriptionItem.quantity === desiredSeats,
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
  let invoiceId: string | undefined
  let invoiceItemCreated = false
  let finalizedStatus: string | null | undefined
  let collectionHandedOff = false
  let paid = false
  try {
    const stripe = requireStripeClient()

    const {
      paymentMethodId: defaultPaymentMethod,
      collectionMethod,
      daysUntilDue,
    } = await resolveDefaultPaymentMethod(stripe, payload.stripeSubscriptionId, payload.customerId)
    if (!collectionMethod) {
      throw new Error('Unable to resolve subscription collection method for overage invoice')
    }
    if (collectionMethod === 'send_invoice' && daysUntilDue == null) {
      throw new Error('Subscription invoice payment terms are required for send_invoice overage')
    }

    const idempotencySuffix = payload.claimId ?? ctx.eventId
    const invoiceIdemKey = `${payload.invoiceIdemKeyStem}:${idempotencySuffix}`
    const itemIdemKey = `${payload.itemIdemKeyStem}:${idempotencySuffix}`
    const finalizeIdemKey = `${payload.invoiceIdemKeyStem}:finalize:${idempotencySuffix}`

    // `auto_advance: false` + explicit finalize mirrors pre-refactor
    // behavior: we control exactly when the invoice finalizes, so it
    // doesn't silently convert to paid/open on Stripe's schedule while
    // our retry state is still in flight.
    const invoice = await stripe.invoices.create(
      {
        customer: payload.customerId,
        collection_method: collectionMethod,
        auto_advance: false,
        description: payload.description,
        metadata: payload.metadata,
        ...(collectionMethod === 'send_invoice' ? { days_until_due: daysUntilDue as number } : {}),
        ...(collectionMethod === 'charge_automatically' && defaultPaymentMethod
          ? { default_payment_method: defaultPaymentMethod }
          : {}),
      },
      { idempotencyKey: invoiceIdemKey }
    )

    if (!invoice.id) {
      throw new Error('Stripe returned invoice without id')
    }
    invoiceId = invoice.id

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
    invoiceItemCreated = true

    const finalized = await stripe.invoices.finalizeInvoice(
      invoice.id,
      {},
      { idempotencyKey: finalizeIdemKey }
    )
    finalizedStatus = finalized.status

    paid = finalized.status === 'paid'
    if (finalized.status === 'paid') {
      collectionHandedOff = true
    } else if (finalized.status === 'open' && finalized.id) {
      paid = await handOffOpenOverageInvoiceCollection({
        stripe,
        payload,
        invoiceId: finalized.id,
        collectionMethod,
        defaultPaymentMethod,
        idempotencySuffix,
      })
      collectionHandedOff = true
    } else {
      throw new Error(
        `Finalized overage invoice has terminal status: ${finalized.status ?? 'unknown'}`
      )
    }

    if (payload.claimId) {
      await db
        .update(billingClaim)
        .set({
          stripeInvoiceId: invoice.id,
          status: paid ? 'paid' : 'invoiced',
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(billingClaim.id, payload.claimId),
            inArray(billingClaim.status, BILLING_CLAIM_INVOICE_WRITEABLE_STATUSES)
          )
        )
    }

    logger.info('Created threshold overage invoice via outbox', {
      eventId: ctx.eventId,
      claimId: payload.claimId,
      invoiceId: invoice.id,
      customerId: payload.customerId,
      amountCents: payload.amountCents,
      billingPeriod: payload.billingPeriod,
      collectionMethod,
      defaultPaymentMethod: defaultPaymentMethod ? 'resolved' : 'none',
    })
  } catch (error) {
    if (payload.claimId && ctx.attempts + 1 >= ctx.maxAttempts) {
      if (await wasOverageInvoiceClaimRequeuedFromEvent(payload.claimId, ctx.eventId)) {
        logger.warn('Skipping late terminal failure handling for timeout-requeued claim', {
          claimId: payload.claimId,
          eventId: ctx.eventId,
        })
        throw error
      }

      if (!invoiceId || !invoiceItemCreated) {
        await failOrRequeueOverageInvoiceClaim(payload, ctx.eventId, error)
      } else if (finalizedStatus && collectionHandedOff) {
        await markOverageInvoiceClaimCreated(payload.claimId, invoiceId, paid)
      } else if (finalizedStatus) {
        await resolveUnfinalizedOverageInvoiceFailure(payload, invoiceId, ctx.eventId, error)
      } else {
        await resolveUnfinalizedOverageInvoiceFailure(payload, invoiceId, ctx.eventId, error)
      }
    }
    throw error
  }
}

async function wasOverageInvoiceClaimRequeuedFromEvent(
  claimId: string,
  outboxEventId: string
): Promise<boolean> {
  const rows = await db
    .select({ id: billingClaim.id })
    .from(billingClaim)
    .where(
      and(
        eq(billingClaim.id, claimId),
        sql`${billingClaim.metadata}->>'invoiceRecoveryFromOutboxEventId' = ${outboxEventId}`
      )
    )
    .limit(1)

  return rows.length > 0
}

stripeThresholdOverageInvoice.onTimeout = async (payload, ctx, error) => {
  if (!payload.claimId) return
  await requeueOverageInvoiceClaim(payload, ctx.eventId, error, true)
}

async function handOffOpenOverageInvoiceCollection(params: {
  stripe: ReturnType<typeof requireStripeClient>
  payload: StripeThresholdOverageInvoicePayload
  invoiceId: string
  collectionMethod: 'charge_automatically' | 'send_invoice'
  defaultPaymentMethod?: string
  idempotencySuffix: string
}): Promise<boolean> {
  if (params.collectionMethod === 'send_invoice') {
    await params.stripe.invoices.sendInvoice(
      params.invoiceId,
      {},
      {
        idempotencyKey: `${params.payload.invoiceIdemKeyStem}:send:${params.idempotencySuffix}`,
      }
    )
    await params.stripe.invoices.update(
      params.invoiceId,
      { auto_advance: true },
      {
        idempotencyKey: `${params.payload.invoiceIdemKeyStem}:auto-advance:${params.idempotencySuffix}`,
      }
    )
    return false
  }

  if (params.defaultPaymentMethod) {
    try {
      const paidInvoice = await params.stripe.invoices.pay(
        params.invoiceId,
        { payment_method: params.defaultPaymentMethod },
        { idempotencyKey: `${params.payload.invoiceIdemKeyStem}:pay:${params.idempotencySuffix}` }
      )
      if (paidInvoice.status === 'paid') return true
    } catch (payError) {
      logger.warn('Auto-pay failed for overage invoice; enabling Stripe collection', {
        invoiceId: params.invoiceId,
        error: toError(payError).message,
      })
    }
  }

  await params.stripe.invoices.update(
    params.invoiceId,
    { auto_advance: true },
    {
      idempotencyKey: `${params.payload.invoiceIdemKeyStem}:auto-advance:${params.idempotencySuffix}`,
    }
  )
  return false
}

async function markOverageInvoiceClaimCreated(claimId: string, invoiceId: string, paid: boolean) {
  await db
    .update(billingClaim)
    .set({
      stripeInvoiceId: invoiceId,
      status: paid ? 'paid' : 'invoiced',
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(billingClaim.id, claimId),
        inArray(billingClaim.status, BILLING_CLAIM_INVOICE_WRITEABLE_STATUSES)
      )
    )
}

async function markOverageInvoiceClaimUnresolved(
  claimId: string,
  invoiceId: string,
  outboxEventId: string,
  error: unknown
) {
  await db
    .update(billingClaim)
    .set({
      stripeInvoiceId: invoiceId,
      status: 'failed',
      metadata: sql`COALESCE(${billingClaim.metadata}, '{}'::jsonb) || ${JSON.stringify({
        invoiceFailureOutboxEventId: outboxEventId,
        invoiceFailureError: toError(error).message,
        invoiceFailureState: 'stripe_invoice_created_before_failure',
      })}::jsonb`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(billingClaim.id, claimId),
        inArray(billingClaim.status, BILLING_CLAIM_INVOICE_WRITEABLE_STATUSES)
      )
    )
}

async function resolveUnfinalizedOverageInvoiceFailure(
  payload: StripeThresholdOverageInvoicePayload,
  invoiceId: string,
  outboxEventId: string,
  error: unknown
) {
  const { claimId } = payload
  if (!claimId) return
  const stripe = requireStripeClient()

  try {
    const invoice = await stripe.invoices.retrieve(invoiceId)
    if (invoice.status === 'paid') {
      await markOverageInvoiceClaimCreated(claimId, invoiceId, true)
      return
    }
    if (invoice.status === 'open') {
      try {
        const {
          paymentMethodId: defaultPaymentMethod,
          collectionMethod,
          daysUntilDue,
        } = await resolveDefaultPaymentMethod(
          stripe,
          payload.stripeSubscriptionId,
          payload.customerId
        )
        if (!collectionMethod) {
          throw new Error('Unable to resolve subscription collection method for overage invoice')
        }
        if (collectionMethod === 'send_invoice' && daysUntilDue == null) {
          throw new Error(
            'Subscription invoice payment terms are required for send_invoice overage'
          )
        }
        const paid = await handOffOpenOverageInvoiceCollection({
          stripe,
          payload,
          invoiceId,
          collectionMethod,
          defaultPaymentMethod,
          idempotencySuffix: claimId,
        })
        await markOverageInvoiceClaimCreated(claimId, invoiceId, paid)
        return
      } catch (handoffError) {
        logger.error('Failed to hand off open overage invoice collection', {
          claimId,
          invoiceId,
          error: toError(handoffError).message,
        })
        if (await requeueOverageInvoiceClaim(payload, outboxEventId, handoffError, true)) {
          return
        }
        await markOverageInvoiceClaimUnresolved(claimId, invoiceId, outboxEventId, handoffError)
        return
      }
    }
    if (invoice.status === 'uncollectible') {
      await markOverageInvoiceClaimUnresolved(claimId, invoiceId, outboxEventId, error)
      return
    }
    if (invoice.status === 'void') {
      await failOrRequeueOverageInvoiceClaim(payload, outboxEventId, error)
      return
    }

    if (!invoice.status || invoice.status === 'draft') {
      try {
        await stripe.invoices.del(invoiceId, {
          idempotencyKey: `overage-invoice-delete:${claimId}`,
        })
        await failOrRequeueOverageInvoiceClaim(payload, outboxEventId, error)
        return
      } catch (deleteError) {
        logger.error('Failed to delete unresolved draft overage invoice', {
          claimId,
          invoiceId,
          error: toError(deleteError).message,
        })
        if (await requeueOverageInvoiceClaim(payload, outboxEventId, deleteError, true)) {
          return
        }
      }
    }
  } catch (resolveError) {
    logger.error('Failed to resolve unfinalized overage invoice state', {
      claimId,
      invoiceId,
      error: toError(resolveError).message,
    })
    if (await requeueOverageInvoiceClaim(payload, outboxEventId, resolveError, true)) {
      return
    }
  }

  await markOverageInvoiceClaimUnresolved(claimId, invoiceId, outboxEventId, error)
}

async function requeueOverageInvoiceClaim(
  payload: StripeThresholdOverageInvoicePayload,
  outboxEventId: string,
  error: unknown,
  reuseIdempotencyStems: boolean
): Promise<boolean> {
  const claimId = payload.claimId
  if (!claimId) return false

  return db.transaction(async (tx) => {
    const [claim] = await tx
      .select({
        id: billingClaim.id,
        status: billingClaim.status,
        metadata: billingClaim.metadata,
      })
      .from(billingClaim)
      .where(
        and(
          eq(billingClaim.id, claimId),
          inArray(billingClaim.status, BILLING_CLAIM_INVOICE_WRITEABLE_STATUSES)
        )
      )
      .for('update')
      .limit(1)

    if (!claim) return false
    const nextRecoveryAttempt = getInvoiceRecoveryAttemptCount(claim.metadata) + 1
    if (nextRecoveryAttempt > MAX_OVERAGE_INVOICE_RECOVERY_ATTEMPTS) {
      logger.error('Overage invoice recovery attempts exhausted', {
        claimId,
        outboxEventId,
        maxAttempts: MAX_OVERAGE_INVOICE_RECOVERY_ATTEMPTS,
        error: toError(error).message,
      })
      return false
    }

    const recoveryOutboxEventId = await enqueueOutboxEvent(
      tx,
      OUTBOX_EVENT_TYPES.STRIPE_THRESHOLD_OVERAGE_INVOICE,
      {
        ...payload,
        invoiceIdemKeyStem: reuseIdempotencyStems
          ? payload.invoiceIdemKeyStem
          : `${payload.invoiceIdemKeyStem}:recovery:${outboxEventId}`,
        itemIdemKeyStem: reuseIdempotencyStems
          ? payload.itemIdemKeyStem
          : `${payload.itemIdemKeyStem}:recovery:${outboxEventId}`,
      },
      { availableAt: new Date(Date.now() + 60_000) }
    )

    await tx
      .update(billingClaim)
      .set({
        metadata: sql`COALESCE(${billingClaim.metadata}, '{}'::jsonb) || ${JSON.stringify({
          invoiceRecoveryOutboxEventId: recoveryOutboxEventId,
          invoiceRecoveryFromOutboxEventId: outboxEventId,
          invoiceRecoveryError: toError(error).message,
          invoiceRecoveryReusedIdempotencyStems: reuseIdempotencyStems,
          invoiceRecoveryAttemptCount: nextRecoveryAttempt,
        })}::jsonb`,
        updatedAt: new Date(),
      })
      .where(eq(billingClaim.id, claimId))

    return true
  })
}

async function failOrRequeueOverageInvoiceClaim(
  payload: StripeThresholdOverageInvoicePayload,
  outboxEventId: string,
  error: unknown
) {
  const claimId = payload.claimId
  if (!claimId) return

  const shouldRequeueFinalClaim = await db.transaction(async (tx) => {
    const [claim] = await tx
      .select({
        id: billingClaim.id,
        claimType: billingClaim.claimType,
        status: billingClaim.status,
      })
      .from(billingClaim)
      .where(
        and(
          eq(billingClaim.id, claimId),
          inArray(billingClaim.status, BILLING_CLAIM_INVOICE_WRITEABLE_STATUSES)
        )
      )
      .for('update')
      .limit(1)

    if (!claim || claim.claimType !== 'final') return false

    return true
  })

  if (shouldRequeueFinalClaim) {
    const requeued = await requeueOverageInvoiceClaim(payload, outboxEventId, error, false)
    if (requeued) {
      logger.warn('Requeued final overage invoice after exhausted invoice creation attempts', {
        claimId,
        failedOutboxEventId: outboxEventId,
      })
      return
    }
    await markFinalOverageInvoiceClaimUnresolved(claimId, outboxEventId, error)
    return
  }

  await markOverageInvoiceClaimCreationFailed(claimId, outboxEventId, error)
}

async function markFinalOverageInvoiceClaimUnresolved(
  claimId: string,
  outboxEventId: string,
  error: unknown
) {
  await db
    .update(billingClaim)
    .set({
      status: 'failed',
      updatedAt: new Date(),
      metadata: sql`COALESCE(${billingClaim.metadata}, '{}'::jsonb) || ${JSON.stringify({
        invoiceFailureOutboxEventId: outboxEventId,
        invoiceFailureError: toError(error).message,
        invoiceFailureState: 'final_invoice_creation_exhausted',
      })}::jsonb`,
    })
    .where(
      and(
        eq(billingClaim.id, claimId),
        inArray(billingClaim.status, BILLING_CLAIM_INVOICE_WRITEABLE_STATUSES)
      )
    )
}

async function markOverageInvoiceClaimCreationFailed(
  claimId: string,
  outboxEventId: string,
  error: unknown
) {
  await db.transaction(async (tx) => {
    const [claim] = await tx
      .select({
        id: billingClaim.id,
        status: billingClaim.status,
        entityType: billingClaim.entityType,
        entityId: billingClaim.entityId,
        creditApplied: billingClaim.creditApplied,
      })
      .from(billingClaim)
      .where(
        and(
          eq(billingClaim.id, claimId),
          inArray(billingClaim.status, BILLING_CLAIM_INVOICE_WRITEABLE_STATUSES)
        )
      )
      .for('update')
      .limit(1)

    if (!claim) return

    const creditApplied = Number(claim.creditApplied)
    if (Number.isFinite(creditApplied) && creditApplied > 0) {
      if (claim.entityType === 'organization') {
        await tx
          .update(organization)
          .set({ creditBalance: sql`${organization.creditBalance} + ${creditApplied}` })
          .where(eq(organization.id, claim.entityId))
      } else {
        await tx
          .update(userStats)
          .set({ creditBalance: sql`${userStats.creditBalance} + ${creditApplied}` })
          .where(eq(userStats.userId, claim.entityId))
      }
    }

    await tx
      .update(billingClaim)
      .set({
        status: 'invoice_failed',
        creditApplied: '0',
        updatedAt: new Date(),
        metadata: sql`COALESCE(${billingClaim.metadata}, '{}'::jsonb) || ${JSON.stringify({
          invoiceFailureOutboxEventId: outboxEventId,
          invoiceFailureError: toError(error).message,
        })}::jsonb`,
      })
      .where(eq(billingClaim.id, claimId))
  })
}

const stripeSyncCustomerContact: OutboxHandler<StripeSyncCustomerContactPayload> = async (
  payload,
  ctx
) => {
  const [subscriptionRow] = await db
    .select({
      referenceId: subscriptionTable.referenceId,
      stripeCustomerId: subscriptionTable.stripeCustomerId,
    })
    .from(subscriptionTable)
    .where(eq(subscriptionTable.id, payload.subscriptionId))
    .limit(1)

  if (!subscriptionRow) {
    logger.warn('Subscription not found when syncing Stripe customer contact', {
      eventId: ctx.eventId,
      subscriptionId: payload.subscriptionId,
    })
    return
  }

  if (!subscriptionRow.stripeCustomerId) {
    logger.warn('Subscription has no Stripe customer id when syncing contact', {
      eventId: ctx.eventId,
      subscriptionId: payload.subscriptionId,
    })
    return
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
    logger.warn('Organization owner not found when syncing Stripe customer contact', {
      eventId: ctx.eventId,
      subscriptionId: payload.subscriptionId,
      organizationId: subscriptionRow.referenceId,
    })
    return
  }

  const stripe = requireStripeClient()
  await stripe.customers.update(
    subscriptionRow.stripeCustomerId,
    {
      email: owner.email,
      ...(owner.name ? { name: owner.name } : {}),
    },
    { idempotencyKey: `outbox:${ctx.eventId}` }
  )
  logger.info('Synced Stripe customer contact', {
    eventId: ctx.eventId,
    stripeCustomerId: subscriptionRow.stripeCustomerId,
    subscriptionId: payload.subscriptionId,
    reason: payload.reason,
  })
}

const billingThresholdCheck: OutboxHandler<BillingThresholdCheckPayload> = async (payload) => {
  if (
    !payload.userId ||
    !payload.subscriptionId ||
    !payload.billingEntityType ||
    !payload.billingEntityId
  ) {
    throw new Error('Missing billing attribution for threshold check')
  }

  await checkAndBillOverageThreshold(payload)
}

export const billingOutboxHandlers = {
  [OUTBOX_EVENT_TYPES.STRIPE_SYNC_CANCEL_AT_PERIOD_END]:
    stripeSyncCancelAtPeriodEnd as OutboxHandler<unknown>,
  [OUTBOX_EVENT_TYPES.STRIPE_SYNC_SUBSCRIPTION_SEATS]:
    stripeSyncSubscriptionSeats as OutboxHandler<unknown>,
  [OUTBOX_EVENT_TYPES.STRIPE_THRESHOLD_OVERAGE_INVOICE]:
    stripeThresholdOverageInvoice as OutboxHandler<unknown>,
  [OUTBOX_EVENT_TYPES.STRIPE_SYNC_CUSTOMER_CONTACT]:
    stripeSyncCustomerContact as OutboxHandler<unknown>,
  [OUTBOX_EVENT_TYPES.BILLING_THRESHOLD_CHECK]: billingThresholdCheck as OutboxHandler<unknown>,
} as const
