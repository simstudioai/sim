import { db } from '@sim/db'
import { subscription, user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { eq } from 'drizzle-orm'
import { getHighestPrioritySubscription } from '@/lib/billing/core/plan'
import { getDisplayPlanName, isPaid } from '@/lib/billing/plan-helpers'
import { requireStripeClient } from '@/lib/billing/stripe-client'
import { formatTrialEndDate, hasPaidSubscriptionStatus } from '@/lib/billing/subscriptions/utils'
import { stripeWebhookIdempotency } from '@/lib/billing/webhooks/idempotency'
import { getBaseUrl } from '@/lib/core/utils/urls'

const logger = createLogger('PlanNotices')

async function readRecipient(userId: string) {
  const [recipient] = await db
    .select({ email: user.email, name: user.name })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)
  return recipient?.email ? recipient : null
}

/** The fields of a Stripe subscription the trial reminder reads. */
export interface TrialEndingSubscription {
  id: string
  status: string
  trial_end: number | null
  items: {
    data: Array<{
      quantity?: number | null
      price: { unit_amount: number | null; recurring: { interval: string } | null }
    }>
  }
}

function formatDollars(cents: number): string {
  const dollars = cents / 100
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`
}

/**
 * What the card is charged when a trial converts. Stripe's invoice preview includes any discount a
 * promotion code applied; the subscription's list price is the fallback if the preview fails.
 */
async function readRenewalCharge(
  stripeSubscription: TrialEndingSubscription
): Promise<string | null> {
  const item = stripeSubscription.items?.data?.[0]
  const interval = item?.price.recurring?.interval
  if (!interval) return null
  try {
    const preview = await requireStripeClient().invoices.createPreview({
      subscription: stripeSubscription.id,
    })
    return `${formatDollars(preview.amount_due)}/${interval}`
  } catch (error) {
    logger.warn('Invoice preview failed for the trial reminder; quoting the list price', {
      stripeSubscriptionId: stripeSubscription.id,
      error: getErrorMessage(error),
    })
  }
  if (!item?.price.unit_amount) return null
  return `${formatDollars(item.price.unit_amount * (item.quantity ?? 1))}/${interval}`
}

/**
 * Handles Stripe's `customer.subscription.trial_will_end`, which arrives three days before a trial
 * converts: emails the trialing account the date, the charge, and how to cancel. Sent once per
 * subscription and trial end, however often Stripe redelivers the event.
 */
export async function handleTrialWillEnd(
  stripeSubscription: TrialEndingSubscription
): Promise<void> {
  const trialEnd = stripeSubscription.trial_end
  if (stripeSubscription.status !== 'trialing' || !trialEnd) return

  const [recorded] = await db
    .select({ plan: subscription.plan, referenceId: subscription.referenceId })
    .from(subscription)
    .where(eq(subscription.stripeSubscriptionId, stripeSubscription.id))
    .limit(1)
  if (!recorded) {
    logger.warn('Trial ending for a subscription Sim has not recorded', {
      stripeSubscriptionId: stripeSubscription.id,
    })
    return
  }

  await stripeWebhookIdempotency.executeWithIdempotency(
    'trial-ending-reminder',
    `${stripeSubscription.id}:${trialEnd}`,
    async () => {
      const [recipient, price] = await Promise.all([
        readRecipient(recorded.referenceId),
        readRenewalCharge(stripeSubscription),
      ])
      if (!recipient || !price) return { sent: false }

      const { getTrialEndingSubject, renderTrialEndingEmail } = await import('@/components/emails')
      const { sendEmail } = await import('@/lib/messaging/email/mailer')
      const planName = getDisplayPlanName(recorded.plan)
      const endsOn = formatTrialEndDate(new Date(trialEnd * 1000))
      const html = await renderTrialEndingEmail({
        planName,
        userName: recipient.name || undefined,
        endsOn,
        price,
        billingLink: `${getBaseUrl()}/account/settings/billing`,
      })
      const result = await sendEmail({
        to: recipient.email,
        subject: getTrialEndingSubject(planName, endsOn),
        html,
        emailType: 'transactional',
      })
      // Throwing leaves the reminder unrecorded, so Stripe's redelivery retries it.
      if (!result.success) throw new Error('Trial reminder email failed to send')
      return { sent: true }
    }
  )
}

/**
 * Tells a payer whose paid plan just ended that Sim-hosted models, tools, and Chat stopped, and
 * how to keep workflows running. Skipped when the owner is still covered by another paid plan, such
 * as an organization's or a restored personal Pro. Never throws: a missed notice must not fail
 * the deletion webhook that settles the final invoice.
 *
 * @param ownerId - the account the plan's emails go to: the user on a personal plan, the owner on
 *   an organization's
 */
export async function sendPlanEndedEmail(
  ended: { id: string; plan: string | null; referenceId: string },
  ownerId: string
) {
  try {
    if (!isPaid(ended.plan)) return
    const current = await getHighestPrioritySubscription(ownerId, { onError: 'throw' })
    const stillPaid =
      current &&
      current.id !== ended.id &&
      isPaid(current.plan) &&
      hasPaidSubscriptionStatus(current.status)
    if (stillPaid) return

    const recipient = await readRecipient(ownerId)
    if (!recipient) return

    const { getPlanEndedSubject, renderPlanEndedEmail } = await import('@/components/emails')
    const { sendEmail } = await import('@/lib/messaging/email/mailer')
    const planName = getDisplayPlanName(ended.plan)
    const html = await renderPlanEndedEmail({
      planName,
      userName: recipient.name || undefined,
      upgradeLink: `${getBaseUrl()}/account/settings/billing`,
    })
    const result = await sendEmail({
      to: recipient.email,
      subject: getPlanEndedSubject(planName),
      html,
      emailType: 'transactional',
    })
    // A notice must not fail the deletion it follows; the error log is the alert.
    if (!result.success) {
      logger.error('Plan ended email failed to send', { referenceId: ended.referenceId })
    }
  } catch (error) {
    logger.error('Failed to send plan ended email', { referenceId: ended.referenceId, error })
  }
}
