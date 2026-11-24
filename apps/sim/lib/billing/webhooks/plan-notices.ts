import { db } from '@sim/db'
import { member, subscription, user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { getHighestPrioritySubscription } from '@/lib/billing/core/plan'
import { getDisplayPlanName, isPaid } from '@/lib/billing/plan-helpers'
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

/** What the card is charged when a trial converts, from the subscription's own Stripe price. */
function formatRenewalPrice(stripeSubscription: TrialEndingSubscription): string | null {
  const price = stripeSubscription.items?.data?.[0]?.price
  if (!price?.unit_amount || !price.recurring) return null
  const quantity = stripeSubscription.items.data[0]?.quantity ?? 1
  const dollars = (price.unit_amount * quantity) / 100
  const amount = Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`
  return `${amount}/${price.recurring.interval}`
}

/**
 * Handles Stripe's `customer.subscription.trial_will_end`, which arrives three days before a trial
 * converts: emails the trialing account the date, the charge, and how to cancel. Sent once per
 * subscription and trial end, however often Stripe redelivers the event.
 */
export async function handleTrialWillEnd(
  stripeSubscription: TrialEndingSubscription
): Promise<void> {
  if (stripeSubscription.status !== 'trialing' || !stripeSubscription.trial_end) return

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
    `${stripeSubscription.id}:${stripeSubscription.trial_end}`,
    async () => {
      const recipient = await readRecipient(recorded.referenceId)
      const price = formatRenewalPrice(stripeSubscription)
      if (!recipient || !price) return { sent: false }

      const { getTrialEndingSubject, renderTrialEndingEmail } = await import('@/components/emails')
      const { sendEmail } = await import('@/lib/messaging/email/mailer')
      const planName = getDisplayPlanName(recorded.plan)
      const endsOn = formatTrialEndDate(new Date(stripeSubscription.trial_end * 1000))
      const html = await renderTrialEndingEmail({
        planName,
        userName: recipient.name || undefined,
        endsOn,
        price,
        billingLink: `${getBaseUrl()}/account/settings/billing`,
      })
      await sendEmail({
        to: recipient.email,
        subject: getTrialEndingSubject(planName, endsOn),
        html,
        emailType: 'transactional',
      })
      return { sent: true }
    }
  )
}

/** The account a plan's emails go to: the user on a personal plan, the owner on an organization's. */
async function resolvePlanOwnerId(referenceId: string): Promise<string> {
  const [owner] = await db
    .select({ userId: member.userId })
    .from(member)
    .where(and(eq(member.organizationId, referenceId), eq(member.role, 'owner')))
    .limit(1)
  return owner?.userId ?? referenceId
}

/**
 * Tells a payer whose paid plan just ended that Sim-hosted models, tools, and Chat stopped, and
 * how to keep workflows running. Skipped when the owner is still covered by another paid plan, such
 * as an organization's or a restored personal Pro. Never throws: a missed notice must not fail
 * the deletion webhook that settles the final invoice.
 */
export async function sendPlanEndedEmail(ended: {
  id: string
  plan: string | null
  referenceId: string
}) {
  try {
    if (!isPaid(ended.plan)) return
    const ownerId = await resolvePlanOwnerId(ended.referenceId)
    const current = await getHighestPrioritySubscription(ownerId)
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
    await sendEmail({
      to: recipient.email,
      subject: getPlanEndedSubject(planName),
      html,
      emailType: 'transactional',
    })
  } catch (error) {
    logger.error('Failed to send plan ended email', { referenceId: ended.referenceId, error })
  }
}
