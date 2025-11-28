import { db } from '@sim/db'
import { member, organization, user, userStats } from '@sim/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import type Stripe from 'stripe'
import { getHighestPrioritySubscription } from '@/lib/billing/core/subscription'
import { requireStripeClient } from '@/lib/billing/stripe-client'
import type { CreditPurchaseRequest, CreditPurchaseResponse } from '@/lib/billing/types'
import { createLogger } from '@/lib/logs/console/logger'
import { getBaseUrl } from '@/lib/urls/utils'

const logger = createLogger('CreditPurchase')

/**
 * Creates a Stripe Checkout session for purchasing prepaid credits.
 * Only available for Pro and Team plan users.
 *
 * @param request - The purchase request details
 * @param currentUser - The authenticated user making the purchase
 * @returns Checkout URL and session ID
 */
export async function createCreditPurchaseCheckout({
  amount,
  referenceId,
  referenceType,
  currentUser,
}: CreditPurchaseRequest & {
  currentUser: { id: string; email: string }
}): Promise<CreditPurchaseResponse> {
  // Validate amount
  if (amount < 50) {
    throw new Error('Minimum credit purchase is $50')
  }

  if (amount > 10000) {
    throw new Error(
      'Maximum credit purchase is $10,000. Please contact support for larger purchases.'
    )
  }

  // Get user's subscription
  const subscription = await getHighestPrioritySubscription(currentUser.id)

  if (!subscription || subscription.plan === 'free') {
    throw new Error(
      'Prepaid credits are only available for Pro and Team plans. Please upgrade first.'
    )
  }

  // Validate authorization
  await validatePurchaseAuthorization({
    currentUserId: currentUser.id,
    referenceId,
    referenceType,
    subscription,
  })

  // Get Stripe customer ID
  const stripeCustomerId = await getStripeCustomerId({
    userId: currentUser.id,
    referenceType,
    referenceId,
  })

  if (!stripeCustomerId) {
    throw new Error('Stripe customer not found. Please contact support.')
  }

  // Create Stripe Checkout Session
  const stripe = requireStripeClient()
  const baseUrl = getBaseUrl()

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer: stripeCustomerId,
    line_items: [
      {
        price_data: {
          currency: 'usd',
          product_data: {
            name: 'Prepaid Platform Credits',
            description: `$${amount.toFixed(2)} in platform usage credits`,
          },
          unit_amount: Math.round(amount * 100), // dollars to cents
        },
        quantity: 1,
      },
    ],
    metadata: {
      type: 'credit_purchase',
      amount: amount.toString(),
      referenceId,
      referenceType,
      userId: currentUser.id,
      plan: subscription.plan,
    },
    success_url: `${baseUrl}/billing/credits/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/billing/credits`,
    allow_promotion_codes: false, // Credits are not discountable
  })

  logger.info('Created credit purchase checkout session', {
    userId: currentUser.id,
    amount,
    referenceId,
    referenceType,
    sessionId: session.id,
  })

  return {
    checkoutUrl: session.url!,
    sessionId: session.id,
  }
}

/**
 * Handles successful credit purchase from Stripe webhook.
 * Called when checkout.session.completed event is received.
 */
export async function handleCreditPurchaseComplete(
  session: Stripe.Checkout.Session
): Promise<void> {
  const { amount, referenceId, referenceType, userId, plan } = session.metadata || {}

  if (!amount || !referenceId || !referenceType || !userId) {
    logger.error('Missing metadata in credit purchase session', { sessionId: session.id })
    throw new Error('Invalid credit purchase session metadata')
  }

  const creditAmount = Number.parseFloat(amount)

  if (Number.isNaN(creditAmount) || creditAmount <= 0) {
    logger.error('Invalid credit amount in session', { sessionId: session.id, amount })
    throw new Error('Invalid credit amount')
  }

  // Verify payment was successful
  if (session.payment_status !== 'paid') {
    logger.warn('Credit purchase session not paid', {
      sessionId: session.id,
      status: session.payment_status,
    })
    return
  }

  try {
    if (referenceType === 'user') {
      // Pro plan: Add credits to user
      // Only unblock if blocked for credits_depleted, not payment_failed
      await db
        .update(userStats)
        .set({
          prepaidCreditsBalance: sql`prepaid_credits_balance + ${creditAmount}`,
          prepaidCreditsTotalPurchased: sql`prepaid_credits_total_purchased + ${creditAmount}`,
          prepaidCreditsLastPurchaseAt: new Date(),
          billingBlocked: sql`CASE WHEN billing_blocked_reason = 'credits_depleted' THEN false ELSE billing_blocked END`,
          billingBlockedReason: sql`CASE WHEN billing_blocked_reason = 'credits_depleted' THEN NULL ELSE billing_blocked_reason END`,
        })
        .where(eq(userStats.userId, referenceId))

      logger.info('Added prepaid credits to user', {
        userId: referenceId,
        amount: creditAmount,
        sessionId: session.id,
      })
    } else if (referenceType === 'organization') {
      // Team plan: Add credits to organization
      await db
        .update(organization)
        .set({
          prepaidCreditsBalance: sql`prepaid_credits_balance + ${creditAmount}`,
          prepaidCreditsTotalPurchased: sql`prepaid_credits_total_purchased + ${creditAmount}`,
          prepaidCreditsLastPurchaseAt: new Date(),
        })
        .where(eq(organization.id, referenceId))

      // Also unblock organization members if they were blocked for credits_depleted
      const members = await db
        .select({ userId: member.userId })
        .from(member)
        .where(eq(member.organizationId, referenceId))

      if (members.length > 0) {
        await db
          .update(userStats)
          .set({
            billingBlocked: sql`CASE WHEN billing_blocked_reason = 'credits_depleted' THEN false ELSE billing_blocked END`,
            billingBlockedReason: sql`CASE WHEN billing_blocked_reason = 'credits_depleted' THEN NULL ELSE billing_blocked_reason END`,
          })
          .where(
            sql`${userStats.userId} IN (${sql.join(
              members.map((m) => sql`${m.userId}`),
              sql`, `
            )})`
          )
      }

      logger.info('Added prepaid credits to organization', {
        organizationId: referenceId,
        amount: creditAmount,
        sessionId: session.id,
        membersUnblocked: members.length,
      })
    }

    // TODO: Send confirmation email
    // await sendCreditPurchaseConfirmationEmail({ userId, amount: creditAmount })
  } catch (error) {
    logger.error('Error processing credit purchase', {
      sessionId: session.id,
      error,
      amount: creditAmount,
      referenceId,
      referenceType,
    })
    throw error
  }
}

/**
 * Validates that the current user has permission to purchase credits for the reference entity.
 */
async function validatePurchaseAuthorization({
  currentUserId,
  referenceId,
  referenceType,
  subscription,
}: {
  currentUserId: string
  referenceId: string
  referenceType: 'user' | 'organization'
  subscription: any
}): Promise<void> {
  if (referenceType === 'user') {
    // User can only purchase for themselves
    if (referenceId !== currentUserId) {
      throw new Error('You can only purchase credits for your own account')
    }

    // Must be on Pro plan (not team or enterprise)
    if (subscription.plan !== 'pro') {
      throw new Error('Individual credits are only available for Pro plan users')
    }
  } else if (referenceType === 'organization') {
    // Must be organization owner to purchase organization credits
    const [memberRecord] = await db
      .select({ role: member.role })
      .from(member)
      .where(and(eq(member.organizationId, referenceId), eq(member.userId, currentUserId)))
      .limit(1)

    if (!memberRecord || memberRecord.role !== 'owner') {
      throw new Error('Only organization owners can purchase credits for the organization')
    }

    // Must be on team or enterprise plan
    if (subscription.plan !== 'team' && subscription.plan !== 'enterprise') {
      throw new Error('Organization credits are only available for Team and Enterprise plans')
    }

    // Verify the subscription reference matches
    if (subscription.referenceId !== referenceId) {
      throw new Error('Organization mismatch with subscription')
    }
  } else {
    throw new Error('Invalid reference type')
  }
}

/**
 * Gets the Stripe customer ID for billing the credit purchase.
 */
async function getStripeCustomerId({
  userId,
  referenceType,
  referenceId,
}: {
  userId: string
  referenceType: 'user' | 'organization'
  referenceId: string
}): Promise<string | null> {
  // For both user and organization purchases, we bill the user's Stripe customer
  // (Organizations don't have their own Stripe customers - the owner's customer is used)
  const [userRecord] = await db
    .select({ stripeCustomerId: user.stripeCustomerId })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)

  return userRecord?.stripeCustomerId || null
}
