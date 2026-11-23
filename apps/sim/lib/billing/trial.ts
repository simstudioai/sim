import { db } from '@sim/db'
import { subscription, trialCard, userStats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, isNotNull, ne, notInArray, or } from 'drizzle-orm'
import type Stripe from 'stripe'
import { PRO_CREDIT_TIER, PRO_TRIAL_DAYS } from '@/lib/billing/constants'
import { buildPlanName } from '@/lib/billing/plan-helpers'
import { requireStripeClient } from '@/lib/billing/stripe-client'

const logger = createLogger('ProTrial')

/** Statuses a checkout leaves behind without ever trialing or paying: abandoned or failed. */
const NEVER_STARTED_STATUSES = ['incomplete', 'incomplete_expired']

type TrialCheckoutParams = Pick<
  Stripe.Checkout.SessionCreateParams,
  'payment_method_types' | 'payment_method_collection' | 'subscription_data'
>

/**
 * The Checkout parameters that start a new subscriber's Pro free trial, or none when the checkout
 * does not qualify. Only a personal checkout of the Pro tier qualifies, for an account that has
 * never trialed or held a subscription and still holds its free allowance (an account reusing a
 * deleted one's identity does not). The card is collected up front and must be a card, so its
 * fingerprint can hold it to one trial ({@link enforceOneTrialPerCard}); a trial left without a
 * payment method cancels instead of invoicing.
 */
export async function getProTrialCheckoutParams(params: {
  userId: string
  referenceId: string
  planName: string
}): Promise<TrialCheckoutParams | null> {
  if (params.referenceId !== params.userId) return null
  if (params.planName !== buildPlanName('pro', PRO_CREDIT_TIER.credits)) return null

  const [[stats], [earlierSubscription]] = await Promise.all([
    db
      .select({ freeTierEligible: userStats.freeTierEligible })
      .from(userStats)
      .where(eq(userStats.userId, params.userId))
      .limit(1),
    db
      .select({ id: subscription.id })
      .from(subscription)
      .where(
        and(
          eq(subscription.referenceId, params.userId),
          or(
            isNotNull(subscription.trialStart),
            notInArray(subscription.status, NEVER_STARTED_STATUSES)
          )
        )
      )
      .limit(1),
  ])
  if (!stats?.freeTierEligible || earlierSubscription) return null

  return {
    payment_method_types: ['card'],
    payment_method_collection: 'always',
    subscription_data: {
      trial_period_days: PRO_TRIAL_DAYS,
      trial_settings: { end_behavior: { missing_payment_method: 'cancel' } },
    },
  }
}

/**
 * Holds each card, and each account, to one Pro trial. Runs when a checkout completes: a trial
 * whose card already started another trial, whose account already trialed (two checkouts racing),
 * or whose card cannot be identified ends at once, so Stripe charges the card for the first period
 * as for any paid checkout. The card's claim is recorded under the subscription it started, so a
 * redelivered webhook finds its own claim and keeps the trial.
 *
 * @returns whether the subscription is still in its trial
 */
export async function enforceOneTrialPerCard(
  stripeSubscription: Stripe.Subscription,
  userId: string
): Promise<boolean> {
  if (stripeSubscription.status !== 'trialing') return false

  const stripe = requireStripeClient()
  const reason = await findTrialIneligibility(stripe, stripeSubscription, userId)
  if (!reason) return true

  await stripe.subscriptions.update(
    stripeSubscription.id,
    { trial_end: 'now' },
    { idempotencyKey: `end-ineligible-trial:${stripeSubscription.id}` }
  )
  logger.info('Ended an ineligible trial; the card is charged now', {
    userId,
    stripeSubscriptionId: stripeSubscription.id,
    reason,
  })
  return false
}

async function findTrialIneligibility(
  stripe: Stripe,
  stripeSubscription: Stripe.Subscription,
  userId: string
): Promise<'card-unidentified' | 'account-already-trialed' | 'card-already-trialed' | null> {
  if (await hasEarlierTrial(userId, stripeSubscription.id)) return 'account-already-trialed'
  const fingerprint = await getCardFingerprint(stripe, stripeSubscription.default_payment_method)
  if (!fingerprint) return 'card-unidentified'
  if (!(await claimTrialCard(fingerprint, userId, stripeSubscription.id))) {
    return 'card-already-trialed'
  }
  return null
}

async function getCardFingerprint(
  stripe: Stripe,
  paymentMethod: string | Stripe.PaymentMethod | null
): Promise<string | null> {
  if (!paymentMethod) return null
  const resolved =
    typeof paymentMethod === 'string'
      ? await stripe.paymentMethods.retrieve(paymentMethod)
      : paymentMethod
  return resolved.card?.fingerprint ?? null
}

async function hasEarlierTrial(userId: string, stripeSubscriptionId: string): Promise<boolean> {
  const [earlier] = await db
    .select({ id: subscription.id })
    .from(subscription)
    .where(
      and(
        eq(subscription.referenceId, userId),
        isNotNull(subscription.trialStart),
        ne(subscription.stripeSubscriptionId, stripeSubscriptionId)
      )
    )
    .limit(1)
  return Boolean(earlier)
}

/** Claims the card for this trial; true when the claim is this subscription's. */
async function claimTrialCard(
  fingerprint: string,
  userId: string,
  stripeSubscriptionId: string
): Promise<boolean> {
  const [claimed] = await db
    .insert(trialCard)
    .values({ fingerprint, userId, stripeSubscriptionId })
    .onConflictDoNothing({ target: trialCard.fingerprint })
    .returning({ fingerprint: trialCard.fingerprint })
  if (claimed) return true

  const [holder] = await db
    .select({ stripeSubscriptionId: trialCard.stripeSubscriptionId })
    .from(trialCard)
    .where(eq(trialCard.fingerprint, fingerprint))
    .limit(1)
  return holder?.stripeSubscriptionId === stripeSubscriptionId
}
