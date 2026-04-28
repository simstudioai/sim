import { render } from '@react-email/render'
import { db } from '@sim/db'
import {
  member,
  organization,
  subscription as subscriptionTable,
  user,
  userStats,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm'
import type Stripe from 'stripe'
import { getEmailSubject, PaymentFailedEmail, renderCreditPurchaseEmail } from '@/components/emails'
import { calculateSubscriptionOverage, isSubscriptionOrgScoped } from '@/lib/billing/core/billing'
import { addCredits, getCreditBalanceForEntity } from '@/lib/billing/credits/balance'
import { setUsageLimitForCredits } from '@/lib/billing/credits/purchase'
import { blockOrgMembers, unblockOrgMembers } from '@/lib/billing/organizations/membership'
import { isEnterprise } from '@/lib/billing/plan-helpers'
import { requireStripeClient } from '@/lib/billing/stripe-client'
import { resolveDefaultPaymentMethod } from '@/lib/billing/stripe-payment-method'
import { ENTITLED_SUBSCRIPTION_STATUSES } from '@/lib/billing/subscriptions/utils'
import { toDecimal, toNumber } from '@/lib/billing/utils/decimal'
import { stripeWebhookIdempotency } from '@/lib/billing/webhooks/idempotency'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { sendEmail } from '@/lib/messaging/email/mailer'
import { getPersonalEmailFrom } from '@/lib/messaging/email/utils'
import { quickValidateEmail } from '@/lib/messaging/email/validation'

const logger = createLogger('StripeInvoiceWebhooks')

const METADATA_SUBSCRIPTION_INVOICE_TYPES = new Set<string>([
  'overage_billing',
  'overage_threshold_billing',
  'overage_threshold_billing_org',
])

type InvoiceSubscriptionResolutionSource =
  | 'parent.subscription_details.subscription'
  | 'metadata.subscriptionId'
  | 'none'

interface InvoiceSubscriptionContext {
  invoiceType: string | null
  resolutionSource: InvoiceSubscriptionResolutionSource
  stripeSubscriptionId: string | null
}

type BillingSubscription = typeof subscriptionTable.$inferSelect

interface ResolvedInvoiceSubscription extends InvoiceSubscriptionContext {
  sub: BillingSubscription
  stripeSubscriptionId: string
}

function resolveInvoiceSubscriptionContext(invoice: Stripe.Invoice): InvoiceSubscriptionContext {
  const invoiceType = invoice.metadata?.type ?? null
  const canResolveFromMetadata = !!(
    invoiceType && METADATA_SUBSCRIPTION_INVOICE_TYPES.has(invoiceType)
  )
  const metadataSubscriptionId =
    canResolveFromMetadata &&
    typeof invoice.metadata?.subscriptionId === 'string' &&
    invoice.metadata.subscriptionId.length > 0
      ? invoice.metadata.subscriptionId
      : null

  const parentSubscription = invoice.parent?.subscription_details?.subscription
  const parentSubscriptionId =
    typeof parentSubscription === 'string' ? parentSubscription : (parentSubscription?.id ?? null)

  if (
    parentSubscriptionId &&
    metadataSubscriptionId &&
    parentSubscriptionId !== metadataSubscriptionId
  ) {
    logger.warn('Invoice has conflicting subscription identifiers', {
      invoiceId: invoice.id,
      invoiceType,
      metadataSubscriptionId,
      parentSubscriptionId,
    })
  }

  if (parentSubscriptionId) {
    return {
      invoiceType,
      resolutionSource: 'parent.subscription_details.subscription',
      stripeSubscriptionId: parentSubscriptionId,
    }
  }

  if (metadataSubscriptionId) {
    return {
      invoiceType,
      resolutionSource: 'metadata.subscriptionId',
      stripeSubscriptionId: metadataSubscriptionId,
    }
  }

  return {
    invoiceType,
    resolutionSource: 'none',
    stripeSubscriptionId: null,
  }
}

async function resolveInvoiceSubscription(
  invoice: Stripe.Invoice,
  handlerName: string
): Promise<ResolvedInvoiceSubscription | null> {
  const subscriptionContext = resolveInvoiceSubscriptionContext(invoice)

  if (!subscriptionContext.stripeSubscriptionId) {
    logger.info('No subscription found on invoice; skipping handler', {
      handlerName,
      invoiceId: invoice.id,
      invoiceType: subscriptionContext.invoiceType,
      resolutionSource: subscriptionContext.resolutionSource,
    })
    return null
  }

  const records = await db
    .select()
    .from(subscriptionTable)
    .where(eq(subscriptionTable.stripeSubscriptionId, subscriptionContext.stripeSubscriptionId))
    .limit(1)

  if (records.length === 0) {
    logger.warn('Subscription not found in database for invoice', {
      handlerName,
      invoiceId: invoice.id,
      invoiceType: subscriptionContext.invoiceType,
      resolutionSource: subscriptionContext.resolutionSource,
      stripeSubscriptionId: subscriptionContext.stripeSubscriptionId,
    })
    return null
  }

  return {
    ...subscriptionContext,
    stripeSubscriptionId: subscriptionContext.stripeSubscriptionId,
    sub: records[0],
  }
}

/**
 * Create a billing portal URL for a Stripe customer
 */
async function createBillingPortalUrl(stripeCustomerId: string): Promise<string> {
  try {
    const stripe = requireStripeClient()
    const baseUrl = getBaseUrl()
    const portal = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: `${baseUrl}/workspace?billing=updated`,
    })
    return portal.url
  } catch (error) {
    logger.error('Failed to create billing portal URL', { error, stripeCustomerId })
    // Fallback to generic billing page
    return `${getBaseUrl()}/workspace?tab=subscription`
  }
}

/**
 * Get payment method details from Stripe invoice
 */
async function getPaymentMethodDetails(
  invoice: Stripe.Invoice
): Promise<{ lastFourDigits?: string; failureReason?: string }> {
  let lastFourDigits: string | undefined
  let failureReason: string | undefined

  // Try to get last 4 digits from payment method
  try {
    const stripe = requireStripeClient()

    // Try to get from default payment method
    if (invoice.default_payment_method && typeof invoice.default_payment_method === 'string') {
      const paymentMethod = await stripe.paymentMethods.retrieve(invoice.default_payment_method)
      if (paymentMethod.card?.last4) {
        lastFourDigits = paymentMethod.card.last4
      }
    }

    // If no default payment method, try getting from customer's default
    if (!lastFourDigits && invoice.customer && typeof invoice.customer === 'string') {
      const customer = await stripe.customers.retrieve(invoice.customer)
      if (customer && !('deleted' in customer)) {
        const defaultPm = customer.invoice_settings?.default_payment_method
        if (defaultPm && typeof defaultPm === 'string') {
          const paymentMethod = await stripe.paymentMethods.retrieve(defaultPm)
          if (paymentMethod.card?.last4) {
            lastFourDigits = paymentMethod.card.last4
          }
        }
      }
    }
  } catch (error) {
    logger.warn('Failed to retrieve payment method details', { error, invoiceId: invoice.id })
  }

  // Get failure message - check multiple sources
  if (invoice.last_finalization_error?.message) {
    failureReason = invoice.last_finalization_error.message
  }

  // If not found, check the payments array (requires expand: ['payments'])
  if (!failureReason && invoice.payments?.data) {
    const defaultPayment = invoice.payments.data.find((p) => p.is_default)
    const payment = defaultPayment || invoice.payments.data[0]

    if (payment?.payment) {
      try {
        const stripe = requireStripeClient()

        if (payment.payment.type === 'payment_intent' && payment.payment.payment_intent) {
          const piId =
            typeof payment.payment.payment_intent === 'string'
              ? payment.payment.payment_intent
              : payment.payment.payment_intent.id

          const paymentIntent = await stripe.paymentIntents.retrieve(piId)
          if (paymentIntent.last_payment_error?.message) {
            failureReason = paymentIntent.last_payment_error.message
          }
        } else if (payment.payment.type === 'charge' && payment.payment.charge) {
          const chargeId =
            typeof payment.payment.charge === 'string'
              ? payment.payment.charge
              : payment.payment.charge.id

          const charge = await stripe.charges.retrieve(chargeId)
          if (charge.failure_message) {
            failureReason = charge.failure_message
          }
        }
      } catch (error) {
        logger.warn('Failed to retrieve payment details for failure reason', {
          error,
          invoiceId: invoice.id,
        })
      }
    }
  }

  return { lastFourDigits, failureReason }
}

/**
 * Send payment failure notification emails to affected users
 * Note: This is only called when billing is enabled (Stripe plugin loaded)
 */
async function sendPaymentFailureEmails(
  sub: { plan: string | null; referenceId: string },
  invoice: Stripe.Invoice,
  stripeCustomerId: string
): Promise<void> {
  try {
    const billingPortalUrl = await createBillingPortalUrl(stripeCustomerId)
    const amountDue = invoice.amount_due / 100 // Convert cents to dollars
    const { lastFourDigits, failureReason } = await getPaymentMethodDetails(invoice)

    // Notify based on subscription scope — org-scoped subs alert owners/admins.
    let usersToNotify: Array<{ email: string; name: string | null }> = []
    const orgScoped = await isSubscriptionOrgScoped(sub)

    if (orgScoped) {
      const members = await db
        .select({
          userId: member.userId,
          role: member.role,
        })
        .from(member)
        .where(eq(member.organizationId, sub.referenceId))

      const ownerAdminIds = members
        .filter((m) => m.role === 'owner' || m.role === 'admin')
        .map((m) => m.userId)

      if (ownerAdminIds.length > 0) {
        const users = await db
          .select({ email: user.email, name: user.name })
          .from(user)
          .where(inArray(user.id, ownerAdminIds))

        usersToNotify = users.filter((u) => u.email && quickValidateEmail(u.email).isValid)
      }
    } else {
      const users = await db
        .select({ email: user.email, name: user.name })
        .from(user)
        .where(eq(user.id, sub.referenceId))
        .limit(1)

      if (users.length > 0) {
        usersToNotify = users.filter((u) => u.email && quickValidateEmail(u.email).isValid)
      }
    }

    // Send emails to all affected users
    for (const userToNotify of usersToNotify) {
      try {
        const emailHtml = await render(
          PaymentFailedEmail({
            userName: userToNotify.name || undefined,
            amountDue,
            lastFourDigits,
            billingPortalUrl,
            failureReason,
            sentDate: new Date(),
          })
        )

        const { from, replyTo } = getPersonalEmailFrom()
        await sendEmail({
          to: userToNotify.email,
          subject: 'Payment Failed - Action Required',
          html: emailHtml,
          from,
          replyTo,
          emailType: 'transactional',
        })

        logger.info('Payment failure email sent', {
          email: userToNotify.email,
          invoiceId: invoice.id,
        })
      } catch (emailError) {
        logger.error('Failed to send payment failure email', {
          error: emailError,
          email: userToNotify.email,
        })
      }
    }
  } catch (error) {
    logger.error('Failed to send payment failure emails', { error })
  }
}

/**
 * Get total billed overage for a subscription, handling org-scoped vs
 * personally-scoped plans.
 * - Org-scoped (team, enterprise, or `pro_*` attached to an org):
 *   stored on the org owner's `userStats.billedOverageThisPeriod`.
 * - Personally-scoped: the user's own `billedOverageThisPeriod`.
 */
export async function getBilledOverageForSubscription(sub: {
  plan: string | null
  referenceId: string
}): Promise<number> {
  if (await isSubscriptionOrgScoped(sub)) {
    const ownerRows = await db
      .select({ userId: member.userId })
      .from(member)
      .where(and(eq(member.organizationId, sub.referenceId), eq(member.role, 'owner')))
      .limit(1)

    const ownerId = ownerRows[0]?.userId

    if (!ownerId) {
      logger.warn('Organization has no owner when fetching billed overage', {
        organizationId: sub.referenceId,
      })
      return 0
    }

    const ownerStats = await db
      .select({ billedOverageThisPeriod: userStats.billedOverageThisPeriod })
      .from(userStats)
      .where(eq(userStats.userId, ownerId))
      .limit(1)

    return ownerStats.length > 0 ? toNumber(toDecimal(ownerStats[0].billedOverageThisPeriod)) : 0
  }

  const userStatsRecords = await db
    .select({ billedOverageThisPeriod: userStats.billedOverageThisPeriod })
    .from(userStats)
    .where(eq(userStats.userId, sub.referenceId))
    .limit(1)

  return userStatsRecords.length > 0
    ? toNumber(toDecimal(userStatsRecords[0].billedOverageThisPeriod))
    : 0
}

export async function resetUsageForSubscription(sub: { plan: string | null; referenceId: string }) {
  if (await isSubscriptionOrgScoped(sub)) {
    const membersRows = await db
      .select({ userId: member.userId })
      .from(member)
      .where(eq(member.organizationId, sub.referenceId))

    for (const m of membersRows) {
      const currentStats = await db
        .select({
          current: userStats.currentPeriodCost,
          currentCopilot: userStats.currentPeriodCopilotCost,
        })
        .from(userStats)
        .where(eq(userStats.userId, m.userId))
        .limit(1)
      if (currentStats.length > 0) {
        const current = currentStats[0].current || '0'
        const currentCopilot = currentStats[0].currentCopilot || '0'
        await db
          .update(userStats)
          .set({
            lastPeriodCost: current,
            lastPeriodCopilotCost: currentCopilot,
            currentPeriodCost: sql`GREATEST(0, ${userStats.currentPeriodCost} - ${current}::decimal)`,
            currentPeriodCopilotCost: sql`GREATEST(0, ${userStats.currentPeriodCopilotCost} - ${currentCopilot}::decimal)`,
            billedOverageThisPeriod: '0',
          })
          .where(eq(userStats.userId, m.userId))
      }
    }

    await db
      .update(organization)
      .set({ departedMemberUsage: '0' })
      .where(eq(organization.id, sub.referenceId))
  } else {
    const currentStats = await db
      .select({
        current: userStats.currentPeriodCost,
        snapshot: userStats.proPeriodCostSnapshot,
        currentCopilot: userStats.currentPeriodCopilotCost,
      })
      .from(userStats)
      .where(eq(userStats.userId, sub.referenceId))
      .limit(1)
    if (currentStats.length > 0) {
      const current = currentStats[0].current || '0'
      const snapshot = toNumber(toDecimal(currentStats[0].snapshot))
      const currentCopilot = currentStats[0].currentCopilot || '0'

      // Snapshot > 0: user joined a paid org mid-cycle. The pre-join
      // portion was billed on this invoice (snapshot); `currentPeriodCost`
      // is post-join usage the org will bill next cycle-close, so keep
      // it. Only retire the personal-billing trackers here.
      if (snapshot > 0) {
        await db
          .update(userStats)
          .set({
            lastPeriodCost: snapshot.toString(),
            lastPeriodCopilotCost: '0',
            proPeriodCostSnapshot: '0',
            proPeriodCostSnapshotAt: null,
            billedOverageThisPeriod: '0',
          })
          .where(eq(userStats.userId, sub.referenceId))
      } else {
        const totalLastPeriod = toNumber(toDecimal(current).plus(snapshot)).toString()
        // Delta-reset for the same reason as the org branch above.
        await db
          .update(userStats)
          .set({
            lastPeriodCost: totalLastPeriod,
            lastPeriodCopilotCost: currentCopilot,
            currentPeriodCost: sql`GREATEST(0, ${userStats.currentPeriodCost} - ${current}::decimal)`,
            currentPeriodCopilotCost: sql`GREATEST(0, ${userStats.currentPeriodCopilotCost} - ${currentCopilot}::decimal)`,
            proPeriodCostSnapshot: '0',
            proPeriodCostSnapshotAt: null,
            billedOverageThisPeriod: '0',
          })
          .where(eq(userStats.userId, sub.referenceId))
      }
    }
  }
}

/**
 * Handle credit purchase invoice payment succeeded.
 */
async function handleCreditPurchaseSuccess(invoice: Stripe.Invoice): Promise<void> {
  const { entityType, entityId, amountDollars, purchasedBy } = invoice.metadata || {}
  if (!entityType || !entityId || !amountDollars) {
    logger.error('Missing metadata in credit purchase invoice', {
      invoiceId: invoice.id,
      metadata: invoice.metadata,
    })
    return
  }

  if (entityType !== 'user' && entityType !== 'organization') {
    logger.error('Invalid entityType in credit purchase', { invoiceId: invoice.id, entityType })
    return
  }

  const amount = Number.parseFloat(amountDollars)
  if (!Number.isFinite(amount) || amount <= 0) {
    logger.error('Invalid amount in credit purchase', { invoiceId: invoice.id, amountDollars })
    return
  }

  if (!invoice.id) {
    logger.error('Credit purchase invoice missing id, cannot dedupe', {
      metadata: invoice.metadata,
    })
    return
  }

  // Idempotent apply: duplicate Stripe deliveries collapse to a single
  // execution. On exception the key is released (retryFailures: true)
  // so the next Stripe retry runs from scratch. On success, subsequent
  // deliveries short-circuit with the cached result.
  //
  // CRITICAL: everything after `addCredits` must be either idempotent or
  // wrapped in try/catch that does not rethrow. Otherwise a failure
  // after credits commit would release the key and the retry would
  // double-credit. `setUsageLimitForCredits` and the email are both
  // best-effort and wrapped; the subscription lookup before them is a
  // read, safe to rerun.
  await stripeWebhookIdempotency.executeWithIdempotency('credit-purchase', invoice.id, async () => {
    await addCredits(entityType, entityId, amount)

    try {
      const subscription = await db
        .select()
        .from(subscriptionTable)
        .where(
          and(
            eq(subscriptionTable.referenceId, entityId),
            inArray(subscriptionTable.status, ENTITLED_SUBSCRIPTION_STATUSES)
          )
        )
        .limit(1)

      if (subscription.length > 0) {
        const sub = subscription[0]
        const newCreditBalance = await getCreditBalanceForEntity(entityType, entityId)
        await setUsageLimitForCredits(entityType, entityId, sub.plan, sub.seats, newCreditBalance)
      }
    } catch (limitError) {
      // Limit bump is best-effort. Customer already got credits; if the
      // cap doesn't auto-raise they can edit it themselves or another
      // credit purchase will rebase it. Do NOT rethrow — that would
      // release the idempotency claim and double-credit on retry.
      logger.error('Failed to update usage limit after credit purchase', {
        invoiceId: invoice.id,
        entityType,
        entityId,
        error: limitError,
      })
    }

    logger.info('Credit purchase completed via webhook', {
      invoiceId: invoice.id,
      entityType,
      entityId,
      amount,
      purchasedBy,
    })

    try {
      const newBalance = await getCreditBalanceForEntity(entityType, entityId)
      let recipients: Array<{ email: string; name: string | null }> = []

      if (entityType === 'organization') {
        const members = await db
          .select({ userId: member.userId, role: member.role })
          .from(member)
          .where(eq(member.organizationId, entityId))

        const ownerAdminIds = members
          .filter((m) => m.role === 'owner' || m.role === 'admin')
          .map((m) => m.userId)

        if (ownerAdminIds.length > 0) {
          recipients = await db
            .select({ email: user.email, name: user.name })
            .from(user)
            .where(inArray(user.id, ownerAdminIds))
        }
      } else if (purchasedBy) {
        const users = await db
          .select({ email: user.email, name: user.name })
          .from(user)
          .where(eq(user.id, purchasedBy))
          .limit(1)

        recipients = users
      }

      for (const recipient of recipients) {
        if (!recipient.email) continue

        const emailHtml = await renderCreditPurchaseEmail({
          userName: recipient.name || undefined,
          amount,
          newBalance,
        })

        await sendEmail({
          to: recipient.email,
          subject: getEmailSubject('credit-purchase'),
          html: emailHtml,
          emailType: 'transactional',
        })

        logger.info('Sent credit purchase confirmation email', {
          email: recipient.email,
          invoiceId: invoice.id,
        })
      }
    } catch (emailError) {
      // Emails are best-effort — a failure here should NOT release the
      // claim (otherwise Stripe retries would re-credit the user).
      logger.error('Failed to send credit purchase emails', {
        emailError,
        invoiceId: invoice.id,
      })
    }

    return { ok: true }
  })
}

/**
 * Handle invoice payment succeeded webhook.
 * Handles both credit purchases and subscription payments.
 */
export async function handleInvoicePaymentSucceeded(event: Stripe.Event) {
  try {
    const invoice = event.data.object as Stripe.Invoice

    if (invoice.metadata?.type === 'credit_purchase') {
      await handleCreditPurchaseSuccess(invoice)
      return
    }

    await stripeWebhookIdempotency.executeWithIdempotency(
      'invoice-payment-succeeded',
      event.id,
      async () => {
        const resolvedInvoice = await resolveInvoiceSubscription(
          invoice,
          'invoice.payment_succeeded'
        )
        if (!resolvedInvoice) {
          return
        }

        const { sub } = resolvedInvoice
        const subIsOrgScoped = await isSubscriptionOrgScoped(sub)

        let wasBlocked = false
        if (subIsOrgScoped) {
          const membersRows = await db
            .select({ userId: member.userId })
            .from(member)
            .where(eq(member.organizationId, sub.referenceId))
          const memberIds = membersRows.map((m) => m.userId)
          if (memberIds.length > 0) {
            const blockedRows = await db
              .select({ blocked: userStats.billingBlocked })
              .from(userStats)
              .where(inArray(userStats.userId, memberIds))

            wasBlocked = blockedRows.some((row) => !!row.blocked)
          }
        } else {
          const row = await db
            .select({ blocked: userStats.billingBlocked })
            .from(userStats)
            .where(eq(userStats.userId, sub.referenceId))
            .limit(1)
          wasBlocked = row.length > 0 ? !!row[0].blocked : false
        }

        const isProrationInvoice = invoice.billing_reason === 'subscription_update'
        const shouldUnblock = !isProrationInvoice || (invoice.amount_paid ?? 0) > 0

        if (shouldUnblock) {
          if (subIsOrgScoped) {
            await unblockOrgMembers(sub.referenceId, 'payment_failed')
          } else {
            await db
              .update(userStats)
              .set({ billingBlocked: false, billingBlockedReason: null })
              .where(
                and(
                  eq(userStats.userId, sub.referenceId),
                  eq(userStats.billingBlockedReason, 'payment_failed')
                )
              )
          }
        } else {
          logger.info('Skipping unblock for zero-amount proration invoice', {
            invoiceId: invoice.id,
            billingReason: invoice.billing_reason,
            amountPaid: invoice.amount_paid,
          })
        }

        if (wasBlocked && !isProrationInvoice) {
          await resetUsageForSubscription({ plan: sub.plan, referenceId: sub.referenceId })
        }
      }
    )
  } catch (error) {
    logger.error('Failed to handle invoice payment succeeded', { eventId: event.id, error })
    throw error
  }
}

/**
 * Handle invoice payment failed webhook
 * This is triggered when a user's payment fails for any invoice (subscription or overage)
 */
export async function handleInvoicePaymentFailed(event: Stripe.Event) {
  try {
    const invoice = event.data.object as Stripe.Invoice

    await stripeWebhookIdempotency.executeWithIdempotency(
      'invoice-payment-failed',
      event.id,
      async () => {
        const resolvedInvoice = await resolveInvoiceSubscription(invoice, 'invoice.payment_failed')
        if (!resolvedInvoice) {
          return
        }

        const { invoiceType, resolutionSource, stripeSubscriptionId, sub } = resolvedInvoice

        const customerId = invoice.customer
        if (!customerId || typeof customerId !== 'string') {
          logger.error('Invalid customer ID on invoice', {
            invoiceId: invoice.id,
            customer: invoice.customer,
          })
          return
        }

        const failedAmount = invoice.amount_due / 100
        const billingPeriod = invoice.metadata?.billingPeriod || 'unknown'
        const attemptCount = invoice.attempt_count ?? 1

        logger.warn('Invoice payment failed', {
          invoiceId: invoice.id,
          customerId,
          failedAmount,
          billingPeriod,
          attemptCount,
          customerEmail: invoice.customer_email,
          hostedInvoiceUrl: invoice.hosted_invoice_url,
          invoiceType: invoiceType ?? 'subscription',
          resolutionSource,
        })

        if (attemptCount >= 1) {
          logger.error('Payment failure - blocking users', {
            customerId,
            attemptCount,
            invoiceId: invoice.id,
            invoiceType: invoiceType ?? 'subscription',
            resolutionSource,
            stripeSubscriptionId,
          })

          if (await isSubscriptionOrgScoped(sub)) {
            const memberCount = await blockOrgMembers(sub.referenceId, 'payment_failed')
            logger.info('Blocked org members due to payment failure', {
              invoiceType: invoiceType ?? 'subscription',
              memberCount,
              organizationId: sub.referenceId,
            })
          } else {
            await db
              .update(userStats)
              .set({ billingBlocked: true, billingBlockedReason: 'payment_failed' })
              .where(
                and(
                  eq(userStats.userId, sub.referenceId),
                  or(
                    ne(userStats.billingBlockedReason, 'dispute'),
                    isNull(userStats.billingBlockedReason)
                  )
                )
              )
            logger.info('Blocked user due to payment failure', {
              invoiceType: invoiceType ?? 'subscription',
              userId: sub.referenceId,
            })
          }

          if (attemptCount === 1) {
            await sendPaymentFailureEmails(sub, invoice, customerId)
            logger.info('Payment failure email sent on first attempt', {
              customerId,
              invoiceId: invoice.id,
            })
          } else {
            logger.info('Skipping payment failure email on retry attempt', {
              attemptCount,
              customerId,
              invoiceId: invoice.id,
            })
          }
        }
      }
    )
  } catch (error) {
    logger.error('Failed to handle invoice payment failed', {
      eventId: event.id,
      error,
    })
    throw error
  }
}

/**
 * Handle base invoice finalized → create a separate overage-only invoice
 * Note: Enterprise plans no longer have overages
 */
export async function handleInvoiceFinalized(event: Stripe.Event) {
  try {
    const invoice = event.data.object as Stripe.Invoice
    const subscription = invoice.parent?.subscription_details?.subscription
    const stripeSubscriptionId = typeof subscription === 'string' ? subscription : subscription?.id
    if (!stripeSubscriptionId) {
      logger.info('No subscription found on invoice; skipping finalized handler', {
        invoiceId: invoice.id,
      })
      return
    }
    if (invoice.billing_reason && invoice.billing_reason !== 'subscription_cycle') return

    const records = await db
      .select()
      .from(subscriptionTable)
      .where(eq(subscriptionTable.stripeSubscriptionId, stripeSubscriptionId))
      .limit(1)

    if (records.length === 0) return
    const sub = records[0]

    if (isEnterprise(sub.plan)) {
      await resetUsageForSubscription({ plan: sub.plan, referenceId: sub.referenceId })
      return
    }

    await stripeWebhookIdempotency.executeWithIdempotency(
      'invoice-finalized',
      event.id,
      async () => {
        const stripe = requireStripeClient()
        const periodEnd =
          invoice.lines?.data?.[0]?.period?.end ||
          invoice.period_end ||
          Math.floor(Date.now() / 1000)
        const billingPeriod = new Date(periodEnd * 1000).toISOString().slice(0, 7)

        const totalOverage = await calculateSubscriptionOverage(sub)

        const entityType = (await isSubscriptionOrgScoped(sub)) ? 'organization' : 'user'
        const entityId = sub.referenceId

        // Resolve the userStats row that holds the `billedOverageThisPeriod`
        // tracker. Org subs: the owner's row. Personal: the user's own row.
        // Throw if an org has no owner — returning early would cache a
        // "successful" no-op, and the next cycle's tracker would still
        // reflect this cycle's billed amount, breaking future overage math.
        let trackerUserId: string
        if (entityType === 'organization') {
          const ownerRows = await db
            .select({ userId: member.userId })
            .from(member)
            .where(and(eq(member.organizationId, entityId), eq(member.role, 'owner')))
            .limit(1)
          const ownerId = ownerRows[0]?.userId
          if (!ownerId) {
            throw new Error(
              `Organization ${entityId} has no owner member; cannot process invoice finalization`
            )
          }
          trackerUserId = ownerId
        } else {
          trackerUserId = entityId
        }

        // Phase 1 — atomic commit. Lock the tracker row first so we read
        // `billedOverageThisPeriod` serialized against concurrent events;
        // then read the credit balance, decrement it, and bump the
        // tracker to `totalOverage`. On retry, the locked re-read sees
        // `billed == totalOverage` → `remaining == 0` → credit removal
        // skipped. That's the invariant preventing double-deduction.
        const phase1 = await db.transaction(async (tx) => {
          const trackerRows = await tx
            .select({ billed: userStats.billedOverageThisPeriod })
            .from(userStats)
            .where(eq(userStats.userId, trackerUserId))
            .for('update')
            .limit(1)

          const billedInTx = trackerRows.length > 0 ? toNumber(toDecimal(trackerRows[0].billed)) : 0
          const remaining = Math.max(0, totalOverage - billedInTx)

          if (remaining === 0) {
            return { billedInTx, applied: 0, billed: 0, remaining: 0 }
          }

          const lockedBalance =
            entityType === 'organization'
              ? await tx
                  .select({ creditBalance: organization.creditBalance })
                  .from(organization)
                  .where(eq(organization.id, entityId))
                  .for('update')
                  .limit(1)
              : await tx
                  .select({ creditBalance: userStats.creditBalance })
                  .from(userStats)
                  .where(eq(userStats.userId, entityId))
                  .for('update')
                  .limit(1)

          const creditBalance =
            lockedBalance.length > 0 ? toNumber(toDecimal(lockedBalance[0].creditBalance)) : 0

          const applied = Math.min(creditBalance, remaining)
          const billed = remaining - applied

          if (applied > 0) {
            if (entityType === 'organization') {
              await tx
                .update(organization)
                .set({
                  creditBalance: sql`GREATEST(0, ${organization.creditBalance} - ${applied})`,
                })
                .where(eq(organization.id, entityId))
            } else {
              await tx
                .update(userStats)
                .set({
                  creditBalance: sql`GREATEST(0, ${userStats.creditBalance} - ${applied})`,
                })
                .where(eq(userStats.userId, entityId))
            }
          }

          await tx
            .update(userStats)
            .set({ billedOverageThisPeriod: totalOverage.toString() })
            .where(eq(userStats.userId, trackerUserId))

          return { billedInTx, applied, billed, remaining }
        })

        const creditsApplied = phase1.applied
        const amountToBillStripe = phase1.billed

        logger.info('Invoice finalized overage calculation', {
          subscriptionId: sub.id,
          totalOverage,
          billedOverageBeforeTx: phase1.billedInTx,
          creditsApplied,
          amountToBillStripe,
          billingPeriod,
        })

        // Phase 2 — Stripe invoice. Runs outside any DB transaction.
        // Every call uses a deterministic idempotency key so retries
        // converge on the same invoice object: re-create returns the
        // existing draft, re-finalize no-ops on an already-finalized
        // invoice, re-pay no-ops on an already-paid invoice.
        if (amountToBillStripe > 0) {
          const customerId = String(invoice.customer)
          const cents = Math.round(amountToBillStripe * 100)
          const itemIdemKey = `overage-item:${customerId}:${stripeSubscriptionId}:${billingPeriod}`
          const invoiceIdemKey = `overage-invoice:${customerId}:${stripeSubscriptionId}:${billingPeriod}`
          const finalizeIdemKey = `overage-finalize:${customerId}:${stripeSubscriptionId}:${billingPeriod}`
          const payIdemKey = `overage-pay:${customerId}:${stripeSubscriptionId}:${billingPeriod}`

          const { paymentMethodId: defaultPaymentMethod, collectionMethod } =
            await resolveDefaultPaymentMethod(stripe, stripeSubscriptionId, customerId)

          const effectiveCollectionMethod = collectionMethod ?? 'charge_automatically'

          const overageInvoice = await stripe.invoices.create(
            {
              customer: customerId,
              collection_method: effectiveCollectionMethod,
              auto_advance: false,
              ...(defaultPaymentMethod ? { default_payment_method: defaultPaymentMethod } : {}),
              metadata: {
                type: 'overage_billing',
                billingPeriod,
                subscriptionId: stripeSubscriptionId,
              },
            },
            { idempotencyKey: invoiceIdemKey }
          )

          await stripe.invoiceItems.create(
            {
              customer: customerId,
              invoice: overageInvoice.id,
              amount: cents,
              currency: 'usd',
              description: `Usage Based Overage – ${billingPeriod}`,
              metadata: {
                type: 'overage_billing',
                billingPeriod,
                subscriptionId: stripeSubscriptionId,
              },
            },
            { idempotencyKey: itemIdemKey }
          )

          const draftId = overageInvoice.id
          if (typeof draftId !== 'string' || draftId.length === 0) {
            logger.error('Stripe created overage invoice without id; aborting finalize')
          } else {
            const finalized = await stripe.invoices.finalizeInvoice(
              draftId,
              {},
              { idempotencyKey: finalizeIdemKey }
            )
            if (
              effectiveCollectionMethod === 'charge_automatically' &&
              finalized.status === 'open'
            ) {
              try {
                const payId = finalized.id
                if (typeof payId !== 'string' || payId.length === 0) {
                  logger.error('Finalized invoice missing id')
                  throw new Error('Finalized invoice missing id')
                }
                await stripe.invoices.pay(
                  payId,
                  { payment_method: defaultPaymentMethod },
                  { idempotencyKey: payIdemKey }
                )
              } catch (payError) {
                logger.error('Failed to auto-pay overage invoice', {
                  error: payError,
                  invoiceId: finalized.id,
                })
              }
            }
          }
        }

        // Phase 3 — reset usage for the new period. Clears trackers and
        // rolls `currentPeriodCost` forward by delta. Idempotent on its
        // own (delta subtraction of a value that's already been
        // subtracted is a no-op).
        await resetUsageForSubscription({ plan: sub.plan, referenceId: sub.referenceId })

        return { totalOverage, creditsApplied, amountToBillStripe }
      }
    )
  } catch (error) {
    logger.error('Failed to handle invoice finalized', { error })
    throw error
  }
}
