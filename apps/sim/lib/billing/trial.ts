import { db } from '@sim/db'
import { subscription, trialCard, userStats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, asc, eq, isNotNull, notInArray, or } from 'drizzle-orm'
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
 * whose card already started another trial, whose account already has an earlier trial (two
 * checkouts racing), or whose card cannot be identified ends at once, so Stripe charges the card
 * for the first period as for any paid checkout.
 *
 * Every trial records a claim on its card, and the first claim wins: a card's winner is whichever
 * subscription claimed it, and an account's winner is its earliest claim. The verdict reads only
 * the claims, so a redelivered webhook reaches the same verdict, and a check that failed partway
 * is safe to run again.
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

/**
 * Enforces {@link enforceOneTrialPerCard} for a completed checkout, from the webhook path that
 * Stripe retries on failure, so a check that failed in the plugin's completion hook still runs.
 */
export async function enforceOneTrialPerCardForCheckout(
  session: Stripe.Checkout.Session
): Promise<void> {
  if (session.mode !== 'subscription' || !session.subscription || !session.client_reference_id) {
    return
  }
  const subscriptionId =
    typeof session.subscription === 'string' ? session.subscription : session.subscription.id
  const stripeSubscription = await requireStripeClient().subscriptions.retrieve(subscriptionId)
  await enforceOneTrialPerCard(stripeSubscription, session.client_reference_id)
}

async function findTrialIneligibility(
  stripe: Stripe,
  stripeSubscription: Stripe.Subscription,
  userId: string
): Promise<'card-unidentified' | 'card-already-trialed' | 'account-already-trialed' | null> {
  const fingerprint = await getCardFingerprint(stripe, stripeSubscription.default_payment_method)
  if (!fingerprint) return 'card-unidentified'

  await db
    .insert(trialCard)
    .values({ fingerprint, userId, stripeSubscriptionId: stripeSubscription.id })
    .onConflictDoNothing({ target: trialCard.fingerprint })
  const claims = await db
    .select({
      fingerprint: trialCard.fingerprint,
      userId: trialCard.userId,
      stripeSubscriptionId: trialCard.stripeSubscriptionId,
    })
    .from(trialCard)
    .where(or(eq(trialCard.fingerprint, fingerprint), eq(trialCard.userId, userId)))
    .orderBy(asc(trialCard.createdAt), asc(trialCard.stripeSubscriptionId))

  const cardWinner = claims.find((claim) => claim.fingerprint === fingerprint)
  if (cardWinner?.stripeSubscriptionId !== stripeSubscription.id) return 'card-already-trialed'
  const accountWinner = claims.find((claim) => claim.userId === userId)
  if (accountWinner?.stripeSubscriptionId !== stripeSubscription.id) {
    return 'account-already-trialed'
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
