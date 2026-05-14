import { render } from '@react-email/render'
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
import { and, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm'
import type Stripe from 'stripe'
import { getEmailSubject, PaymentFailedEmail, renderCreditPurchaseEmail } from '@/components/emails'
import {
  BILLING_CLAIM_PAYMENT_BLOCKING_STATUSES,
  BILLING_CLAIM_WEBHOOK_MUTABLE_STATUSES,
} from '@/lib/billing/claims/status'
import { isSubscriptionOrgScoped } from '@/lib/billing/core/billing'
import { addCredits, getCreditBalanceForEntity } from '@/lib/billing/credits/balance'
import { setUsageLimitForCredits } from '@/lib/billing/credits/purchase'
import { createOverageBillingClaim } from '@/lib/billing/ledger/usage-ledger'
import { blockOrgMembers } from '@/lib/billing/organizations/membership'
import { isEnterprise, isPooledOrganizationPlan } from '@/lib/billing/plan-helpers'
import { requireStripeClient } from '@/lib/billing/stripe-client'
import { ENTITLED_SUBSCRIPTION_STATUSES } from '@/lib/billing/subscriptions/utils'
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

function resolveInvoiceCustomerId(invoice: Stripe.Invoice): string | null {
  const { customer } = invoice
  if (typeof customer === 'string') {
    return customer || null
  }
  if (!customer || ('deleted' in customer && customer.deleted)) {
    return null
  }
  return customer.id || null
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
    logger.error('Subscription not found in database for subscription invoice', {
      handlerName,
      invoiceId: invoice.id,
      invoiceType: subscriptionContext.invoiceType,
      resolutionSource: subscriptionContext.resolutionSource,
      stripeSubscriptionId: subscriptionContext.stripeSubscriptionId,
    })
    throw new Error('Subscription row is required for subscription invoice handling')
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

export async function resetUsageForSubscription(sub: { plan: string | null; referenceId: string }) {
  await clearLegacyCoveredOverageForSubscription(sub)

  if (!(await isSubscriptionOrgScoped(sub))) {
    await db
      .update(userStats)
      .set({
        proPeriodCostSnapshot: '0',
        proPeriodCostSnapshotAt: null,
      })
      .where(eq(userStats.userId, sub.referenceId))
  }
}

async function clearLegacyCoveredOverageForSubscription(sub: {
  plan: string | null
  referenceId: string
}) {
  if (await isSubscriptionOrgScoped(sub)) {
    const [ownerRow] = await db
      .select({ userId: member.userId })
      .from(member)
      .where(and(eq(member.organizationId, sub.referenceId), eq(member.role, 'owner')))
      .limit(1)

    if (ownerRow?.userId) {
      await db
        .update(userStats)
        .set({ billedOverageThisPeriod: '0' })
        .where(eq(userStats.userId, ownerRow.userId))
    }

    await db
      .update(organization)
      .set({ departedMemberUsage: '0' })
      .where(eq(organization.id, sub.referenceId))
  } else {
    await db
      .update(userStats)
      .set({
        billedOverageThisPeriod: '0',
      })
      .where(eq(userStats.userId, sub.referenceId))
  }
}

async function getOrganizationBillingContactIds(organizationId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: member.userId })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), inArray(member.role, ['owner', 'admin'])))

  return rows.map((row) => row.userId)
}

async function getOrganizationBillingContactsBlocked(organizationId: string): Promise<boolean> {
  const contactIds = await getOrganizationBillingContactIds(organizationId)
  if (contactIds.length === 0) return false

  const rows = await db
    .select({ blocked: userStats.billingBlocked })
    .from(userStats)
    .where(inArray(userStats.userId, contactIds))

  return rows.some((row) => !!row.blocked)
}

async function blockOrganizationBillingContacts(organizationId: string): Promise<number> {
  const contactIds = await getOrganizationBillingContactIds(organizationId)
  if (contactIds.length === 0) return 0

  const rows = await db
    .update(userStats)
    .set({ billingBlocked: true, billingBlockedReason: 'payment_failed' })
    .where(
      and(
        inArray(userStats.userId, contactIds),
        or(ne(userStats.billingBlockedReason, 'dispute'), isNull(userStats.billingBlockedReason))
      )
    )
    .returning({ userId: userStats.userId })

  return rows.length
}

async function unblockOrganizationBillingContacts(organizationId: string): Promise<number> {
  const contactIds = await getOrganizationBillingContactIds(organizationId)
  if (contactIds.length === 0) return 0

  return unblockUsersWithoutPersonalPaymentIssue(contactIds)
}

async function unblockOrganizationMembersWithoutPersonalPaymentIssue(
  organizationId: string
): Promise<number> {
  const rows = await db
    .select({ userId: member.userId })
    .from(member)
    .where(eq(member.organizationId, organizationId))

  return unblockUsersWithoutPersonalPaymentIssue(rows.map((row) => row.userId))
}

async function unblockUsersWithoutPersonalPaymentIssue(userIds: string[]): Promise<number> {
  if (userIds.length === 0) return 0

  const unblockableContactIds: string[] = []
  for (const userId of userIds) {
    if (await hasPersonalPaymentIssue(userId)) continue
    unblockableContactIds.push(userId)
  }
  if (unblockableContactIds.length === 0) return 0

  const rows = await db
    .update(userStats)
    .set({ billingBlocked: false, billingBlockedReason: null })
    .where(
      and(
        inArray(userStats.userId, unblockableContactIds),
        eq(userStats.billingBlockedReason, 'payment_failed')
      )
    )
    .returning({ userId: userStats.userId })

  return rows.length
}

async function hasPersonalPaymentIssue(userId: string): Promise<boolean> {
  const [pastDueSubscription] = await db
    .select({ id: subscriptionTable.id })
    .from(subscriptionTable)
    .where(and(eq(subscriptionTable.referenceId, userId), eq(subscriptionTable.status, 'past_due')))
    .limit(1)

  if (pastDueSubscription) return true

  return hasUnresolvedBillingClaimsForEntity('user', userId)
}

async function hasUnresolvedBillingClaimsForEntity(
  entityType: 'user' | 'organization',
  entityId: string
): Promise<boolean> {
  const rows = await db
    .select({ id: billingClaim.id })
    .from(billingClaim)
    .where(
      and(
        eq(billingClaim.entityType, entityType),
        eq(billingClaim.entityId, entityId),
        inArray(billingClaim.status, BILLING_CLAIM_PAYMENT_BLOCKING_STATUSES)
      )
    )
    .limit(1)

  return rows.length > 0
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

        await updateBillingClaimFromInvoice(invoice, 'paid')

        const { sub } = resolvedInvoice
        const subIsOrgScoped = await isSubscriptionOrgScoped(sub)
        const subIsPooledOrgScoped = subIsOrgScoped && isPooledOrganizationPlan(sub.plan)

        let wasBlocked = false
        if (subIsPooledOrgScoped) {
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
        } else if (subIsOrgScoped) {
          wasBlocked = await getOrganizationBillingContactsBlocked(sub.referenceId)
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
        const hasUnresolvedClaims = await hasUnresolvedBillingClaimsForEntity(
          subIsOrgScoped ? 'organization' : 'user',
          sub.referenceId
        )

        if (shouldUnblock && !hasUnresolvedClaims) {
          if (subIsPooledOrgScoped) {
            await unblockOrganizationMembersWithoutPersonalPaymentIssue(sub.referenceId)
          } else if (subIsOrgScoped) {
            await unblockOrganizationBillingContacts(sub.referenceId)
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
          logger.info('Skipping unblock after invoice payment', {
            invoiceId: invoice.id,
            billingReason: invoice.billing_reason,
            amountPaid: invoice.amount_paid,
            hasUnresolvedClaims,
          })
        }

        if (!resolvedInvoice.invoiceType && wasBlocked && !isProrationInvoice) {
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

        await updateBillingClaimFromInvoice(invoice, 'failed')

        const { invoiceType, resolutionSource, stripeSubscriptionId, sub } = resolvedInvoice

        const customerId = resolveInvoiceCustomerId(invoice)
        if (!customerId) {
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

          const subIsOrgScoped = await isSubscriptionOrgScoped(sub)
          if (subIsOrgScoped && isPooledOrganizationPlan(sub.plan)) {
            const memberCount = await blockOrgMembers(sub.referenceId, 'payment_failed')
            logger.info('Blocked org members due to payment failure', {
              invoiceType: invoiceType ?? 'subscription',
              memberCount,
              organizationId: sub.referenceId,
            })
          } else if (subIsOrgScoped) {
            const contactCount = await blockOrganizationBillingContacts(sub.referenceId)
            logger.info('Blocked organization billing contacts due to payment failure', {
              invoiceType: invoiceType ?? 'subscription',
              contactCount,
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

export async function handleInvoiceVoided(event: Stripe.Event) {
  const invoice = event.data.object as Stripe.Invoice
  await moveClaimForTerminalInvoice(invoice, 'invoice_failed')
}

export async function handleInvoiceMarkedUncollectible(event: Stripe.Event) {
  const invoice = event.data.object as Stripe.Invoice
  await moveClaimForTerminalInvoice(invoice, 'failed')
}

async function updateBillingClaimFromInvoice(
  invoice: Stripe.Invoice,
  status: 'paid' | 'failed'
): Promise<void> {
  const claimId = invoice.metadata?.claimId
  if (!claimId) return

  const condition =
    status === 'failed'
      ? and(
          eq(billingClaim.id, claimId),
          inArray(billingClaim.status, BILLING_CLAIM_WEBHOOK_MUTABLE_STATUSES)
        )
      : and(
          eq(billingClaim.id, claimId),
          inArray(billingClaim.status, BILLING_CLAIM_WEBHOOK_MUTABLE_STATUSES)
        )

  await db
    .update(billingClaim)
    .set({
      status,
      stripeInvoiceId: invoice.id ?? null,
      updatedAt: new Date(),
    })
    .where(condition)

  logger.info('Updated billing claim from Stripe invoice webhook', {
    claimId,
    invoiceId: invoice.id,
    status,
  })
}

async function moveClaimForTerminalInvoice(
  invoice: Stripe.Invoice,
  status: 'failed' | 'invoice_failed'
): Promise<void> {
  const claimId = invoice.metadata?.claimId
  if (!claimId) return

  await db.transaction(async (tx) => {
    const [claim] = await tx
      .select({
        id: billingClaim.id,
        entityType: billingClaim.entityType,
        entityId: billingClaim.entityId,
        creditApplied: billingClaim.creditApplied,
      })
      .from(billingClaim)
      .where(
        and(
          eq(billingClaim.id, claimId),
          inArray(billingClaim.status, BILLING_CLAIM_WEBHOOK_MUTABLE_STATUSES)
        )
      )
      .for('update')
      .limit(1)

    if (!claim) return

    if (status === 'invoice_failed') {
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
    }

    await tx
      .update(billingClaim)
      .set({
        status,
        creditApplied: status === 'invoice_failed' ? '0' : claim.creditApplied,
        stripeInvoiceId: invoice.id ?? null,
        updatedAt: new Date(),
      })
      .where(eq(billingClaim.id, claimId))
  })
}

function resolveInvoiceServicePeriod(invoice: Stripe.Invoice): {
  periodStart: Date
  periodEnd: Date
} | null {
  const linePeriod = invoice.lines?.data?.find(
    (line) => line.period?.start && line.period?.end
  )?.period
  const periodStartSeconds = linePeriod?.start ?? invoice.period_start
  const periodEndSeconds = linePeriod?.end ?? invoice.period_end

  if (!periodStartSeconds || !periodEndSeconds) {
    return null
  }

  return {
    periodStart: new Date(periodStartSeconds * 1000),
    periodEnd: new Date(periodEndSeconds * 1000),
  }
}

function datesAreClose(left: Date | null | undefined, right: Date | null | undefined): boolean {
  return !!left && !!right && Math.abs(left.getTime() - right.getTime()) < 60_000
}

function resolveClosedUsagePeriod(
  invoice: Stripe.Invoice,
  sub: BillingSubscription
): {
  periodStart: Date
  periodEnd: Date
} | null {
  const servicePeriod = resolveInvoiceServicePeriod(invoice)
  if (!servicePeriod) return null

  const closedPeriodEnd = servicePeriod.periodStart
  if (invoice.period_start && invoice.period_end) {
    const invoicePeriodStart = new Date(invoice.period_start * 1000)
    const invoicePeriodEnd = new Date(invoice.period_end * 1000)
    if (datesAreClose(invoicePeriodEnd, closedPeriodEnd) && invoicePeriodStart < invoicePeriodEnd) {
      return {
        periodStart: invoicePeriodStart,
        periodEnd: invoicePeriodEnd,
      }
    }
  }

  if (datesAreClose(sub.periodEnd, closedPeriodEnd) && sub.periodStart) {
    return {
      periodStart: sub.periodStart,
      periodEnd: closedPeriodEnd,
    }
  }

  const servicePeriodMs = servicePeriod.periodEnd.getTime() - servicePeriod.periodStart.getTime()
  if (servicePeriodMs <= 0) return null

  return {
    periodStart: new Date(closedPeriodEnd.getTime() - servicePeriodMs),
    periodEnd: closedPeriodEnd,
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

    if (records.length === 0) {
      logger.error('Subscription not found in database for finalized invoice', {
        invoiceId: invoice.id,
        stripeSubscriptionId,
      })
      throw new Error('Subscription row is required for finalized invoice handling')
    }
    const sub = records[0]

    if (isEnterprise(sub.plan)) {
      await resetUsageForSubscription({ plan: sub.plan, referenceId: sub.referenceId })
      return
    }
    const orgScoped = await isSubscriptionOrgScoped(sub)

    await stripeWebhookIdempotency.executeWithIdempotency(
      'invoice-finalized',
      event.id,
      async () => {
        const closedUsagePeriod = resolveClosedUsagePeriod(invoice, sub)
        if (!closedUsagePeriod) {
          logger.warn('Invoice finalized without a billing period; skipping final overage claim', {
            invoiceId: invoice.id,
            subscriptionId: sub.id,
            stripeSubscriptionId,
          })
          return
        }

        const { periodStart, periodEnd: claimPeriodEnd } = closedUsagePeriod
        const billingPeriod = claimPeriodEnd.toISOString().slice(0, 7)

        const customerId = resolveInvoiceCustomerId(invoice)
        if (!customerId) {
          throw new Error('Invoice customer id is required for overage billing')
        }
        const claim = await createOverageBillingClaim({
          subscription: {
            ...sub,
            periodStart,
            periodEnd: claimPeriodEnd,
          },
          claimType: 'final',
          periodStart,
          periodEnd: claimPeriodEnd,
          usageCutoff: claimPeriodEnd,
          customerId,
          stripeSubscriptionId,
          description: `Usage overage billing - ${billingPeriod}`,
          itemDescription: `Usage Based Overage - ${billingPeriod}`,
          enqueueStripeInvoice: true,
          metadata: {
            billingPeriod,
            subscriptionId: stripeSubscriptionId,
            sourceInvoiceId: invoice.id ?? 'unknown',
          },
        })

        logger.info('Invoice finalized ledger overage claim completed', {
          subscriptionId: sub.id,
          claimId: claim.claimId,
          claimed: claim.claimed,
          grossUsage: claim.grossUsage,
          overageAmount: claim.overageAmount,
          priorCoveredOverage: claim.priorCoveredOverage,
          creditsApplied: claim.creditApplied,
          amountToBillStripe: claim.amountToBill,
          billingPeriod,
        })

        if (
          !sub.periodEnd ||
          datesAreClose(sub.periodEnd, claimPeriodEnd) ||
          datesAreClose(sub.periodStart, claimPeriodEnd)
        ) {
          await resetUsageForSubscription({ plan: sub.plan, referenceId: sub.referenceId })
        } else {
          await clearLegacyCoveredOverageForSubscription({
            plan: sub.plan,
            referenceId: sub.referenceId,
          })
          logger.warn(
            'Skipping display counter reset because invoice period does not match DB period',
            {
              subscriptionId: sub.id,
              invoicePeriodEnd: claimPeriodEnd.toISOString(),
              subscriptionPeriodEnd: sub.periodEnd?.toISOString() ?? null,
            }
          )
        }

        return {
          totalOverage: claim.priorCoveredOverage + claim.overageAmount,
          creditsApplied: claim.creditApplied,
          amountToBillStripe: claim.amountToBill,
        }
      }
    )
  } catch (error) {
    logger.error('Failed to handle invoice finalized', { error })
    throw error
  }
}
