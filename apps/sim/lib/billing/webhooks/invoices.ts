import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { member, subscription as subscriptionTable, user, userStats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { isOrgAdminRole } from '@sim/platform-authz/workspace'
import { and, eq, inArray, isNull, ne, or } from 'drizzle-orm'
import type Stripe from 'stripe'
import {
  getEmailSubject,
  renderCreditPurchaseEmail,
  renderPaymentFailedEmail,
} from '@/components/emails'
import { isSubscriptionOrgScoped } from '@/lib/billing/core/billing'
import { addCredits, getCreditBalanceForEntity } from '@/lib/billing/credits/balance'
import { setUsageLimitForCredits } from '@/lib/billing/credits/purchase'
import { blockOrgMembers, unblockOrgMembers } from '@/lib/billing/organizations/membership'
import { requireStripeClient } from '@/lib/billing/stripe-client'
import { ENTITLED_SUBSCRIPTION_STATUSES } from '@/lib/billing/subscriptions/utils'
import { toDecimal, toNumber } from '@/lib/billing/utils/decimal'
import { stripeWebhookIdempotency } from '@/lib/billing/webhooks/idempotency'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { sendEmail } from '@/lib/messaging/email/mailer'
import { getHelpEmailAddress, getPersonalEmailFrom } from '@/lib/messaging/email/utils'
import { quickValidateEmail } from '@/lib/messaging/email/validation'
import { APP_ENTRY_PATH } from '@/lib/navigation/paths'
import { captureServerEvent } from '@/lib/posthog/server'

const logger = createLogger('StripeInvoiceWebhooks')

/**
 * Cycle rollover (usage window advance, final overage collection,
 * `billedOverageThisPeriod` reset, last-period bookkeeping) is NOT handled
 * here. Usage windows advance automatically — current usage is the attributed
 * usage_log ledger for the subscription's current period — and the money +
 * bookkeeping close runs off period advance in
 * `@/lib/billing/cycle-close`, independent of invoice payload shape. These
 * handlers only manage payment lifecycle: block/unblock, notification emails,
 * credit purchases, and audit.
 */

/**
 * Resolve the audit actor for a billing event. For org-scoped subscriptions the
 * actor is the org owner; for personal subscriptions it is the reference (user)
 * id. The owner lookup is best-effort — a failure must never break webhook
 * processing, so it falls back to the reference id (which the audit layer nulls
 * to a system actor if it is not a real user id).
 */
async function resolveBillingActorId(isOrgScoped: boolean, referenceId: string): Promise<string> {
  if (!isOrgScoped) return referenceId
  try {
    const ownerRows = await db
      .select({ userId: member.userId })
      .from(member)
      .where(and(eq(member.organizationId, referenceId), eq(member.role, 'owner')))
      .limit(1)
    return ownerRows[0]?.userId ?? referenceId
  } catch (error) {
    logger.warn('Failed to resolve billing actor; falling back to reference id', {
      referenceId,
      error,
    })
    return referenceId
  }
}

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
      return_url: `${baseUrl}${APP_ENTRY_PATH}?billing=updated`,
    })
    return portal.url
  } catch (error) {
    logger.error('Failed to create billing portal URL', { error, stripeCustomerId })
    // Fallback to generic billing page
    return `${getBaseUrl()}${APP_ENTRY_PATH}?tab=subscription`
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

      const ownerAdminIds = members.filter((m) => isOrgAdminRole(m.role)).map((m) => m.userId)

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
        const emailHtml = await renderPaymentFailedEmail({
          userName: userToNotify.name || undefined,
          amountDue,
          lastFourDigits,
          billingPortalUrl,
          failureReason,
        })

        const { from } = getPersonalEmailFrom()
        const replyTo = getHelpEmailAddress()
        await sendEmail({
          to: userToNotify.email,
          subject: getEmailSubject('payment-failed'),
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

    const actorId =
      purchasedBy ?? (await resolveBillingActorId(entityType === 'organization', entityId))
    recordAudit({
      actorId,
      action: AuditAction.CREDIT_PURCHASED,
      resourceType: AuditResourceType.BILLING,
      resourceId: invoice.id,
      description: `Credit purchase of $${amount.toFixed(2)} fulfilled for ${entityType} ${entityId}`,
      metadata: {
        entityType,
        entityId,
        ...(entityType === 'organization' ? { organizationId: entityId } : {}),
        amount,
        currency: 'usd',
        purchasedBy: purchasedBy ?? null,
        invoiceId: invoice.id,
      },
    })
    captureServerEvent(actorId, 'credits_purchased', {
      amount,
      currency: 'usd',
      entity_type: entityType,
      reference_id: entityId,
    })

    try {
      const newBalance = await getCreditBalanceForEntity(entityType, entityId)
      let recipients: Array<{ email: string; name: string | null }> = []

      if (entityType === 'organization') {
        const members = await db
          .select({ userId: member.userId, role: member.role })
          .from(member)
          .where(eq(member.organizationId, entityId))

        const ownerAdminIds = members.filter((m) => isOrgAdminRole(m.role)).map((m) => m.userId)

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

        const entityType = subIsOrgScoped ? 'organization' : 'user'
        const amountPaid = (invoice.amount_paid ?? 0) / 100
        const actorId = await resolveBillingActorId(subIsOrgScoped, sub.referenceId)

        recordAudit({
          actorId,
          action: AuditAction.INVOICE_PAYMENT_SUCCEEDED,
          resourceType: AuditResourceType.BILLING,
          resourceId: invoice.id,
          description: `Invoice payment of $${amountPaid.toFixed(2)} succeeded for ${entityType} ${sub.referenceId}`,
          metadata: {
            entityType,
            referenceId: sub.referenceId,
            ...(entityType === 'organization' ? { organizationId: sub.referenceId } : {}),
            plan: sub.plan,
            amount: amountPaid,
            currency: invoice.currency ?? 'usd',
            invoiceId: invoice.id,
          },
        })
        captureServerEvent(actorId, 'payment_succeeded', {
          plan: sub.plan ?? 'unknown',
          amount: amountPaid,
          currency: invoice.currency ?? 'usd',
          entity_type: entityType,
          reference_id: sub.referenceId,
        })
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

        // Best-effort instrumentation; its DB reads must never abort the
        // user-blocking that follows, so the whole block is guarded.
        try {
          const failureOrgScoped = await isSubscriptionOrgScoped(sub)
          const failureEntityType = failureOrgScoped ? 'organization' : 'user'
          const failureActorId = await resolveBillingActorId(failureOrgScoped, sub.referenceId)

          recordAudit({
            actorId: failureActorId,
            action: AuditAction.INVOICE_PAYMENT_FAILED,
            resourceType: AuditResourceType.BILLING,
            resourceId: invoice.id,
            description: `Invoice payment of $${failedAmount.toFixed(2)} failed for ${failureEntityType} ${sub.referenceId} (attempt ${attemptCount})`,
            metadata: {
              entityType: failureEntityType,
              referenceId: sub.referenceId,
              ...(failureEntityType === 'organization' ? { organizationId: sub.referenceId } : {}),
              plan: sub.plan,
              amount: failedAmount,
              currency: invoice.currency ?? 'usd',
              attemptCount,
              invoiceType: invoiceType ?? 'subscription',
              invoiceId: invoice.id,
            },
          })
          captureServerEvent(failureActorId, 'payment_failed', {
            plan: sub.plan ?? 'unknown',
            amount: failedAmount,
            currency: invoice.currency ?? 'usd',
            entity_type: failureEntityType,
            reference_id: sub.referenceId,
            attempt_count: attemptCount,
          })
        } catch (auditError) {
          logger.warn('Failed to record payment_failed instrumentation', { auditError })
        }

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
