import { AuditAction, AuditResourceType, recordAuditOnce } from '@sim/audit'
import { db } from '@sim/db'
import { outboxEvent, subscription } from '@sim/db/schema'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import type Stripe from 'stripe'
import type { AdminMutationActor } from '@/lib/admin/dashboard'
import { acquireOrganizationMutationLock } from '@/lib/billing/organizations/membership'
import { requireStripeClient } from '@/lib/billing/stripe-client'
import { ENTITLED_SUBSCRIPTION_STATUSES } from '@/lib/billing/subscriptions/utils'
import { OUTBOX_EVENT_TYPES } from '@/lib/billing/webhooks/outbox-handlers'
import { enqueueOutboxEvent } from '@/lib/core/outbox/service'

const RECENT_INVOICE_LIMIT = 12
const INVOICE_PAYMENT_LIMIT = 10
const MAX_RECENT_PAYMENT_CANDIDATES = 20
const STRIPE_LOOKUP_CONCURRENCY = 4

interface RecentSubscriptionPayment {
  chargeId: string
  amountCents: number
  refundedCents: number
  refundableCents: number
  currency: string
  createdAt: string
  invoiceId: string | null
  description: string | null
}

interface InvoicePaymentCandidate {
  invoice: Stripe.Invoice
  payment: Stripe.InvoicePayment
}

export class RefundOperationRejectedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RefundOperationRejectedError'
  }
}

function refundOutcome(status: Stripe.Refund['status']): 'applied' | 'pending' | 'failed' {
  if (status === 'succeeded') return 'applied'
  if (status === 'failed' || status === 'canceled') return 'failed'
  return 'pending'
}

/** Runs a small number of independent Stripe reads concurrently without an unbounded fan-out. */
async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  iteratee: (value: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(values.length)
  let nextIndex = 0
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await iteratee(values[index])
    }
  })
  await Promise.all(workers)
  return results
}

async function getLatestOrganizationStripeSubscription(organizationId: string) {
  const [row] = await db
    .select()
    .from(subscription)
    .where(eq(subscription.referenceId, organizationId))
    .orderBy(
      sql`case when ${subscription.status} in ('active', 'past_due') then 0 else 1 end`,
      desc(subscription.periodStart),
      desc(subscription.id)
    )
    .limit(1)
  if (!row?.stripeSubscriptionId) {
    throw new Error('Stripe organization subscription not found')
  }
  return row
}

async function resolveInvoicePaymentCharge(
  stripe: Stripe,
  payment: Stripe.InvoicePayment
): Promise<Stripe.Charge | null> {
  const directCharge = payment.payment.charge
  if (directCharge) {
    return typeof directCharge === 'string' ? stripe.charges.retrieve(directCharge) : directCharge
  }
  const paymentIntentValue = payment.payment.payment_intent
  if (!paymentIntentValue) return null
  const paymentIntent =
    typeof paymentIntentValue === 'string'
      ? await stripe.paymentIntents.retrieve(paymentIntentValue, { expand: ['latest_charge'] })
      : paymentIntentValue
  const latestCharge = paymentIntent.latest_charge
  if (!latestCharge) return null
  return typeof latestCharge === 'string' ? stripe.charges.retrieve(latestCharge) : latestCharge
}

async function listRecentSubscriptionPayments(stripe: Stripe, stripeSubscriptionId: string) {
  const invoices = await stripe.invoices.list({
    subscription: stripeSubscriptionId,
    limit: RECENT_INVOICE_LIMIT,
    expand: ['data.payments'],
  })
  const paymentsByCharge = new Map<string, RecentSubscriptionPayment>()
  const candidates: InvoicePaymentCandidate[] = []
  const seenPaymentIds = new Set<string>()
  let historyLimited = invoices.has_more

  const invoicePaymentLists = await mapWithConcurrency(
    invoices.data,
    STRIPE_LOOKUP_CONCURRENCY,
    async (invoice) => ({
      invoice,
      payments:
        invoice.payments && !invoice.payments.has_more
          ? invoice.payments
          : await stripe.invoicePayments.list({
              invoice: invoice.id,
              status: 'paid',
              limit: INVOICE_PAYMENT_LIMIT,
              expand: ['data.payment.charge', 'data.payment.payment_intent.latest_charge'],
            }),
    })
  )

  for (const { invoice, payments } of invoicePaymentLists) {
    if (candidates.length >= MAX_RECENT_PAYMENT_CANDIDATES) {
      historyLimited = true
      break
    }
    if (payments.has_more) historyLimited = true
    for (const payment of payments.data) {
      if (payment.status !== 'paid' || seenPaymentIds.has(payment.id)) continue
      if (candidates.length >= MAX_RECENT_PAYMENT_CANDIDATES) {
        historyLimited = true
        break
      }
      seenPaymentIds.add(payment.id)
      candidates.push({ invoice, payment })
    }
  }

  const resolvedCandidates = await mapWithConcurrency(
    candidates,
    STRIPE_LOOKUP_CONCURRENCY,
    async (candidate) => ({
      ...candidate,
      charge: await resolveInvoicePaymentCharge(stripe, candidate.payment),
    })
  )
  for (const { invoice, charge } of resolvedCandidates) {
    if (!charge || !charge.paid || paymentsByCharge.has(charge.id)) continue
    paymentsByCharge.set(charge.id, {
      chargeId: charge.id,
      amountCents: charge.amount_captured,
      refundedCents: charge.amount_refunded,
      refundableCents: Math.max(0, charge.amount_captured - charge.amount_refunded),
      currency: charge.currency,
      createdAt: new Date(charge.created * 1000).toISOString(),
      invoiceId: invoice.id ?? null,
      description: invoice.description ?? charge.description,
    })
  }

  return {
    payments: [...paymentsByCharge.values()],
    historyLimited,
  }
}

async function getDashboardCancellationSync(organizationId: string, subscriptionId: string) {
  const [row] = await db
    .select({
      operationId: sql<string | null>`${outboxEvent.payload} ->> 'operationId'`,
      eventType: outboxEvent.eventType,
      status: outboxEvent.status,
      error: outboxEvent.lastError,
    })
    .from(outboxEvent)
    .where(
      and(
        inArray(outboxEvent.eventType, [
          OUTBOX_EVENT_TYPES.STRIPE_SYNC_CANCEL_AT_PERIOD_END,
          OUTBOX_EVENT_TYPES.STRIPE_CANCEL_SUBSCRIPTION_IMMEDIATELY,
        ]),
        sql`${outboxEvent.payload} ->> 'organizationId' = ${organizationId}`,
        sql`${outboxEvent.payload} ->> 'subscriptionId' = ${subscriptionId}`
      )
    )
    .orderBy(desc(outboxEvent.createdAt), desc(outboxEvent.id))
    .limit(1)
  if (!row?.operationId) return null
  return {
    operationId: row.operationId,
    timing:
      row.eventType === OUTBOX_EVENT_TYPES.STRIPE_CANCEL_SUBSCRIPTION_IMMEDIATELY
        ? ('immediate' as const)
        : ('period_end' as const),
    status:
      row.status === 'completed'
        ? ('applied' as const)
        : row.status === 'dead_letter'
          ? ('failed' as const)
          : row.status === 'processing'
            ? ('processing' as const)
            : ('pending' as const),
    error: row.status === 'dead_letter' ? row.error : null,
  }
}

export async function getDashboardSubscriptionBillingActions(organizationId: string) {
  const subscriptionRow = await getLatestOrganizationStripeSubscription(organizationId)
  const stripe = requireStripeClient()
  const [paymentHistory, cancellationSync] = await Promise.all([
    listRecentSubscriptionPayments(stripe, subscriptionRow.stripeSubscriptionId as string),
    getDashboardCancellationSync(organizationId, subscriptionRow.id),
  ])
  return {
    subscription: {
      id: subscriptionRow.id,
      stripeSubscriptionId: subscriptionRow.stripeSubscriptionId,
      status: subscriptionRow.status,
      cancelAtPeriodEnd: Boolean(subscriptionRow.cancelAtPeriodEnd),
      periodEnd: subscriptionRow.periodEnd?.toISOString() ?? null,
    },
    cancellationSync,
    refundHistoryLimited: paymentHistory.historyLimited,
    refundablePayments: paymentHistory.payments.filter((payment) => payment.refundableCents > 0),
  }
}

export async function requestDashboardSubscriptionCancellation({
  organizationId,
  operationId,
  timing,
  reason,
  actor,
}: {
  organizationId: string
  operationId: string
  timing: 'period_end' | 'immediate'
  reason?: string
  actor: AdminMutationActor
}) {
  const cancellationEventType =
    timing === 'immediate'
      ? OUTBOX_EVENT_TYPES.STRIPE_CANCEL_SUBSCRIPTION_IMMEDIATELY
      : OUTBOX_EVENT_TYPES.STRIPE_SYNC_CANCEL_AT_PERIOD_END
  const normalizedReason =
    reason ??
    (timing === 'immediate'
      ? 'admin-dashboard-cancel-immediately'
      : 'admin-dashboard-cancel-at-period-end')
  const cancellation = await db.transaction(async (tx) => {
    await acquireOrganizationMutationLock(tx, organizationId)

    const [existingOperation] = await tx
      .select({
        id: outboxEvent.id,
        eventType: outboxEvent.eventType,
        status: outboxEvent.status,
        subscriptionId: sql<string>`${outboxEvent.payload} ->> 'subscriptionId'`,
        reason: sql<string | null>`${outboxEvent.payload} ->> 'reason'`,
      })
      .from(outboxEvent)
      .where(
        and(
          inArray(outboxEvent.eventType, [
            OUTBOX_EVENT_TYPES.STRIPE_SYNC_CANCEL_AT_PERIOD_END,
            OUTBOX_EVENT_TYPES.STRIPE_CANCEL_SUBSCRIPTION_IMMEDIATELY,
          ]),
          sql`${outboxEvent.payload} ->> 'operationId' = ${operationId}`,
          sql`${outboxEvent.payload} ->> 'organizationId' = ${organizationId}`
        )
      )
      .for('update')
      .limit(1)
    if (existingOperation) {
      if (
        existingOperation.eventType !== cancellationEventType ||
        existingOperation.reason !== normalizedReason
      ) {
        throw new Error('Cancellation operation ID was already used with different parameters')
      }
      if (existingOperation.status === 'dead_letter') {
        if (existingOperation.eventType === OUTBOX_EVENT_TYPES.STRIPE_SYNC_CANCEL_AT_PERIOD_END) {
          const [restoredSubscription] = await tx
            .update(subscription)
            .set({ cancelAtPeriodEnd: true })
            .where(
              and(
                eq(subscription.id, existingOperation.subscriptionId),
                eq(subscription.referenceId, organizationId)
              )
            )
            .returning({ id: subscription.id })
          if (!restoredSubscription) {
            throw new Error('Cancellation subscription no longer exists')
          }
        }
        await tx
          .update(outboxEvent)
          .set({
            status: 'pending',
            attempts: 0,
            lastError: null,
            availableAt: new Date(),
            lockedAt: null,
            processedAt: null,
          })
          .where(
            and(eq(outboxEvent.id, existingOperation.id), eq(outboxEvent.status, 'dead_letter'))
          )
        return {
          operationId,
          outboxEventId: existingOperation.id,
          subscriptionId: existingOperation.subscriptionId,
          status: 'pending' as const,
        }
      }
      return {
        operationId,
        outboxEventId: existingOperation.id,
        subscriptionId: existingOperation.subscriptionId,
        status:
          existingOperation.status === 'completed'
            ? ('applied' as const)
            : existingOperation.status === 'processing'
              ? ('processing' as const)
              : ('pending' as const),
      }
    }

    const subscriptionRows = await tx
      .select()
      .from(subscription)
      .where(
        and(
          eq(subscription.referenceId, organizationId),
          inArray(subscription.status, ENTITLED_SUBSCRIPTION_STATUSES)
        )
      )
      .orderBy(desc(subscription.periodStart), desc(subscription.id))
      .for('update')
      .limit(2)
    if (subscriptionRows.length > 1) {
      throw new Error(
        'Multiple active organization subscriptions were found. Resolve them in Stripe before cancelling.'
      )
    }
    const [subscriptionRow] = subscriptionRows
    if (!subscriptionRow?.stripeSubscriptionId) {
      throw new Error('Active Stripe organization subscription not found')
    }

    if (timing === 'immediate') {
      const eventId = await enqueueOutboxEvent(
        tx,
        OUTBOX_EVENT_TYPES.STRIPE_CANCEL_SUBSCRIPTION_IMMEDIATELY,
        {
          operationId,
          organizationId,
          subscriptionId: subscriptionRow.id,
          stripeSubscriptionId: subscriptionRow.stripeSubscriptionId,
          reason: normalizedReason,
          requestedBy: actor,
        }
      )
      return {
        operationId,
        outboxEventId: eventId,
        subscriptionId: subscriptionRow.id,
        status: 'pending' as const,
      }
    }

    if (!subscriptionRow.cancelAtPeriodEnd) {
      await tx
        .update(subscription)
        .set({ cancelAtPeriodEnd: true })
        .where(eq(subscription.id, subscriptionRow.id))
    }
    const eventId = await enqueueOutboxEvent(
      tx,
      OUTBOX_EVENT_TYPES.STRIPE_SYNC_CANCEL_AT_PERIOD_END,
      {
        operationId,
        organizationId,
        subscriptionId: subscriptionRow.id,
        stripeSubscriptionId: subscriptionRow.stripeSubscriptionId,
        reason: normalizedReason,
        requestedBy: actor,
      }
    )
    return {
      operationId,
      outboxEventId: eventId,
      subscriptionId: subscriptionRow.id,
      status: 'pending' as const,
    }
  })

  return {
    success: true as const,
    operationId: cancellation.operationId,
    status: cancellation.status,
  }
}

export async function refundDashboardSubscriptionPayment({
  organizationId,
  operationId,
  chargeId,
  amountCents,
  reason,
  note,
  actor,
}: {
  organizationId: string
  operationId: string
  chargeId: string
  amountCents: number
  reason: 'duplicate' | 'fraudulent' | 'requested_by_customer'
  note?: string
  actor: AdminMutationActor
}) {
  const stripe = requireStripeClient()
  const existingRefunds = await stripe.refunds.list({ charge: chargeId, limit: 100 })
  const existingRefund = existingRefunds.data.find(
    (refund) => refund.metadata?.simAdminOperationId === operationId
  )
  if (existingRefund) {
    const metadata = existingRefund.metadata ?? {}
    const subscriptionId = metadata.simSubscriptionId
    if (
      existingRefund.amount !== amountCents ||
      metadata.organizationId !== organizationId ||
      !subscriptionId ||
      existingRefund.reason !== reason ||
      (metadata.adminNote ?? null) !== (note ?? null)
    ) {
      throw new Error('Refund operation ID was already used with different parameters')
    }
    const outcome = refundOutcome(existingRefund.status)
    if (outcome === 'applied') {
      await recordRefundAuditOnce({
        organizationId,
        operationId,
        chargeId,
        refundId: existingRefund.id,
        subscriptionId,
        amountCents,
        reason,
        note,
        actor,
      })
    }
    return {
      success: true as const,
      refundId: existingRefund.id,
      status: existingRefund.status,
      outcome,
      amountCents,
    }
  }
  if (existingRefunds.has_more) {
    throw new Error('Could not safely verify this refund operation. Use Stripe directly.')
  }

  const subscriptionRow = await getLatestOrganizationStripeSubscription(organizationId)
  const paymentHistory = await listRecentSubscriptionPayments(
    stripe,
    subscriptionRow.stripeSubscriptionId as string
  )
  const payment = paymentHistory.payments.find((candidate) => candidate.chargeId === chargeId)
  if (!payment) {
    throw new RefundOperationRejectedError(
      paymentHistory.historyLimited
        ? 'The selected payment is outside the recent refund window. Use Stripe directly.'
        : 'The selected payment does not belong to this subscription'
    )
  }
  if (amountCents > payment.amountCents) {
    throw new RefundOperationRejectedError('Refund amount exceeds the payment amount')
  }
  if (amountCents > payment.refundableCents) {
    throw new RefundOperationRejectedError('Refund amount exceeds the remaining refundable balance')
  }

  const refund = await stripe.refunds.create(
    {
      charge: chargeId,
      amount: amountCents,
      reason,
      metadata: {
        simAdminOperationId: operationId,
        organizationId,
        simSubscriptionId: subscriptionRow.id,
        requestedByEmail: actor.email ?? 'admin-api',
        ...(note ? { adminNote: note } : {}),
      },
    },
    { idempotencyKey: `admin-refund:${operationId}` }
  )
  const outcome = refundOutcome(refund.status)
  if (outcome === 'applied') {
    await recordRefundAuditOnce({
      organizationId,
      operationId,
      chargeId,
      refundId: refund.id,
      subscriptionId: subscriptionRow.id,
      amountCents,
      reason,
      note,
      actor,
    })
  }
  return {
    success: true as const,
    refundId: refund.id,
    status: refund.status,
    outcome,
    amountCents,
  }
}

async function recordRefundAuditOnce({
  organizationId,
  operationId,
  chargeId,
  refundId,
  subscriptionId,
  amountCents,
  reason,
  note,
  actor,
}: {
  organizationId: string
  operationId: string
  chargeId: string
  refundId: string
  subscriptionId: string
  amountCents: number
  reason: 'duplicate' | 'fraudulent' | 'requested_by_customer'
  note?: string
  actor: AdminMutationActor
}): Promise<void> {
  await recordAuditOnce(`admin-refund:${operationId}`, {
    actorId: actor.id,
    actorName: actor.name,
    actorEmail: actor.email,
    action: AuditAction.SUBSCRIPTION_REFUNDED,
    resourceType: AuditResourceType.SUBSCRIPTION,
    resourceId: subscriptionId,
    description: `Admin issued a ${amountCents}-cent refund`,
    metadata: {
      organizationId,
      operationId,
      chargeId,
      refundId,
      amountCents,
      reason,
      note: note ?? null,
    },
  })
}
