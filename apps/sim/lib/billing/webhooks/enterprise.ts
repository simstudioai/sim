import { eq } from 'drizzle-orm'
import type Stripe from 'stripe'
import {
  getEmailSubject,
  renderEnterpriseSubscriptionEmail,
} from '@/components/emails/render-email'
import { sendEmail } from '@/lib/email/mailer'
import { getFromEmailAddress } from '@/lib/email/utils'
import { createLogger } from '@/lib/logs/console/logger'
import { db } from '@/db'
import { organization, subscription, user } from '@/db/schema'
import type { EnterpriseSubscriptionMetadata } from '../types'

const logger = createLogger('BillingEnterprise')

function isEnterpriseMetadata(value: unknown): value is EnterpriseSubscriptionMetadata {
  return (
    !!value &&
    typeof value === 'object' &&
    'plan' in value &&
    'referenceId' in value &&
    'monthlyPrice' in value &&
    'seats' in value &&
    typeof value.plan === 'string' &&
    value.plan.toLowerCase() === 'enterprise' &&
    typeof value.referenceId === 'string' &&
    typeof value.monthlyPrice === 'string' &&
    typeof value.seats === 'string'
  )
}

export async function handleManualEnterpriseSubscription(event: Stripe.Event) {
  const stripeSubscription = event.data.object as Stripe.Subscription

  const metaPlan = (stripeSubscription.metadata?.plan as string | undefined)?.toLowerCase() || ''

  if (metaPlan !== 'enterprise') {
    logger.info('[subscription.created] Skipping non-enterprise subscription', {
      subscriptionId: stripeSubscription.id,
      plan: metaPlan || 'unknown',
    })
    return
  }

  const stripeCustomerId = stripeSubscription.customer as string

  if (!stripeCustomerId) {
    logger.error('[subscription.created] Missing Stripe customer ID', {
      subscriptionId: stripeSubscription.id,
    })
    throw new Error('Missing Stripe customer ID on subscription')
  }

  const metadata = stripeSubscription.metadata || {}

  const referenceId =
    typeof metadata.referenceId === 'string' && metadata.referenceId.length > 0
      ? metadata.referenceId
      : null

  if (!referenceId) {
    logger.error('[subscription.created] Unable to resolve referenceId', {
      subscriptionId: stripeSubscription.id,
      stripeCustomerId,
    })
    throw new Error('Unable to resolve referenceId for subscription')
  }

  if (!isEnterpriseMetadata(metadata)) {
    logger.error('[subscription.created] Invalid enterprise metadata shape', {
      subscriptionId: stripeSubscription.id,
      metadata,
    })
    throw new Error('Invalid enterprise metadata for subscription')
  }
  const enterpriseMetadata = metadata
  const metadataJson: Record<string, unknown> = { ...enterpriseMetadata }

  // Extract and parse seats and monthly price from metadata (they come as strings from Stripe)
  const seats = Number.parseInt(enterpriseMetadata.seats, 10)
  const monthlyPrice = Number.parseFloat(enterpriseMetadata.monthlyPrice)

  if (!seats || seats <= 0 || Number.isNaN(seats)) {
    logger.error('[subscription.created] Invalid or missing seats in enterprise metadata', {
      subscriptionId: stripeSubscription.id,
      seatsRaw: enterpriseMetadata.seats,
      seatsParsed: seats,
    })
    throw new Error('Enterprise subscription must include valid seats in metadata')
  }

  if (!monthlyPrice || monthlyPrice <= 0 || Number.isNaN(monthlyPrice)) {
    logger.error('[subscription.created] Invalid or missing monthlyPrice in enterprise metadata', {
      subscriptionId: stripeSubscription.id,
      monthlyPriceRaw: enterpriseMetadata.monthlyPrice,
      monthlyPriceParsed: monthlyPrice,
    })
    throw new Error('Enterprise subscription must include valid monthlyPrice in metadata')
  }

  // Get the first subscription item which contains the period information
  const referenceItem = stripeSubscription.items?.data?.[0]

  const subscriptionRow = {
    id: crypto.randomUUID(),
    plan: 'enterprise',
    referenceId,
    stripeCustomerId,
    stripeSubscriptionId: stripeSubscription.id,
    status: stripeSubscription.status || null,
    periodStart: referenceItem?.current_period_start
      ? new Date(referenceItem.current_period_start * 1000)
      : null,
    periodEnd: referenceItem?.current_period_end
      ? new Date(referenceItem.current_period_end * 1000)
      : null,
    cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end ?? null,
    seats,
    trialStart: stripeSubscription.trial_start
      ? new Date(stripeSubscription.trial_start * 1000)
      : null,
    trialEnd: stripeSubscription.trial_end ? new Date(stripeSubscription.trial_end * 1000) : null,
    metadata: metadataJson,
  }

  const existing = await db
    .select({ id: subscription.id })
    .from(subscription)
    .where(eq(subscription.stripeSubscriptionId, stripeSubscription.id))
    .limit(1)

  if (existing.length > 0) {
    await db
      .update(subscription)
      .set({
        plan: subscriptionRow.plan,
        referenceId: subscriptionRow.referenceId,
        stripeCustomerId: subscriptionRow.stripeCustomerId,
        status: subscriptionRow.status,
        periodStart: subscriptionRow.periodStart,
        periodEnd: subscriptionRow.periodEnd,
        cancelAtPeriodEnd: subscriptionRow.cancelAtPeriodEnd,
        seats: subscriptionRow.seats,
        trialStart: subscriptionRow.trialStart,
        trialEnd: subscriptionRow.trialEnd,
        metadata: subscriptionRow.metadata,
      })
      .where(eq(subscription.stripeSubscriptionId, stripeSubscription.id))
  } else {
    await db.insert(subscription).values(subscriptionRow)
  }

  // Update the organization's usage limit to match the monthly price
  // The referenceId for enterprise plans is the organization ID
  try {
    await db
      .update(organization)
      .set({
        orgUsageLimit: monthlyPrice.toFixed(2),
        updatedAt: new Date(),
      })
      .where(eq(organization.id, referenceId))

    logger.info('[subscription.created] Updated organization usage limit', {
      organizationId: referenceId,
      usageLimit: monthlyPrice,
    })
  } catch (error) {
    logger.error('[subscription.created] Failed to update organization usage limit', {
      organizationId: referenceId,
      usageLimit: monthlyPrice,
      error,
    })
    // Don't throw - the subscription was created successfully, just log the error
  }

  logger.info('[subscription.created] Upserted enterprise subscription', {
    subscriptionId: subscriptionRow.id,
    referenceId: subscriptionRow.referenceId,
    plan: subscriptionRow.plan,
    status: subscriptionRow.status,
    monthlyPrice,
    seats,
    note: 'Seats from metadata, Stripe quantity set to 1',
  })

  try {
    const userDetails = await db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
      })
      .from(user)
      .where(eq(user.stripeCustomerId, stripeCustomerId))
      .limit(1)

    const orgDetails = await db
      .select({
        id: organization.id,
        name: organization.name,
      })
      .from(organization)
      .where(eq(organization.id, referenceId))
      .limit(1)

    if (userDetails.length > 0 && orgDetails.length > 0) {
      const user = userDetails[0]
      const org = orgDetails[0]

      const html = await renderEnterpriseSubscriptionEmail(user.name || user.email, user.email)

      const emailResult = await sendEmail({
        to: user.email,
        subject: getEmailSubject('enterprise-subscription'),
        html,
        from: getFromEmailAddress(),
        emailType: 'transactional',
      })

      if (emailResult.success) {
        logger.info('[subscription.created] Enterprise subscription email sent successfully', {
          userId: user.id,
          email: user.email,
          organizationId: org.id,
          subscriptionId: subscriptionRow.id,
        })
      } else {
        logger.warn('[subscription.created] Failed to send enterprise subscription email', {
          userId: user.id,
          email: user.email,
          error: emailResult.message,
        })
      }
    } else {
      logger.warn(
        '[subscription.created] Could not find user or organization for email notification',
        {
          userFound: userDetails.length > 0,
          orgFound: orgDetails.length > 0,
          stripeCustomerId,
          referenceId,
        }
      )
    }
  } catch (emailError) {
    logger.error('[subscription.created] Error sending enterprise subscription email', {
      error: emailError,
      stripeCustomerId,
      referenceId,
      subscriptionId: subscriptionRow.id,
    })
  }
}
