import { db } from '@sim/db'
import { member, subscription, user, userStats } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import type Stripe from 'stripe'
import { getCreditBalance, removeCredits } from '@/lib/billing/credits/balance'
import { requireStripeClient } from '@/lib/billing/stripe-client'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('DisputeWebhooks')

/**
 * Handles all charge disputes (chargebacks).
 * Blocks the responsible user and removes credits if applicable.
 */
export async function handleChargeDispute(event: Stripe.Event): Promise<void> {
  const dispute = event.data.object as Stripe.Dispute

  const chargeId = typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id
  if (!chargeId) {
    logger.warn('No charge ID in dispute', { disputeId: dispute.id })
    return
  }

  try {
    const stripe = requireStripeClient()
    const charge = await stripe.charges.retrieve(chargeId)

    // Get payment intent metadata to determine dispute type
    const paymentIntentId = charge.payment_intent
    let metadata: Stripe.Metadata = {}

    if (paymentIntentId) {
      const piId = typeof paymentIntentId === 'string' ? paymentIntentId : paymentIntentId.id
      const paymentIntent = await stripe.paymentIntents.retrieve(piId)
      metadata = paymentIntent.metadata || {}
    }

    if (metadata.type === 'credit_purchase') {
      await handleCreditPurchaseDispute(dispute, metadata)
    } else {
      await handleSubscriptionDispute(dispute, charge)
    }
  } catch (error) {
    logger.error('Failed to handle charge dispute', { error, disputeId: dispute.id })
  }
}

/**
 * Handles disputes for credit purchases.
 * Removes credits and blocks the responsible user.
 */
async function handleCreditPurchaseDispute(
  dispute: Stripe.Dispute,
  metadata: Stripe.Metadata
): Promise<void> {
  const { entityType, entityId, amountDollars, purchasedBy } = metadata

  if (!entityType || !entityId || !amountDollars) {
    logger.warn('Missing metadata in disputed credit purchase', { disputeId: dispute.id })
    return
  }

  const amount = Number.parseFloat(amountDollars)
  if (Number.isNaN(amount) || amount <= 0) {
    return
  }

  // Remove credits if any remain
  const { balance } = await getCreditBalance(entityId)
  const amountToRemove = Math.min(balance, amount)

  if (amountToRemove > 0) {
    await removeCredits(entityType as 'user' | 'organization', entityId, amountToRemove)
  }

  // Block the responsible user
  let blockedUserId: string | null = null

  if (entityType === 'organization') {
    const owners = await db
      .select({ userId: member.userId })
      .from(member)
      .where(and(eq(member.organizationId, entityId), eq(member.role, 'owner')))
      .limit(1)

    blockedUserId = owners[0]?.userId || null
  } else {
    blockedUserId = purchasedBy || null
  }

  if (blockedUserId) {
    await db
      .update(userStats)
      .set({ billingBlocked: true, billingBlockedReason: 'dispute' })
      .where(eq(userStats.userId, blockedUserId))
  }

  logger.warn('Handled credit purchase dispute', {
    disputeId: dispute.id,
    blockedUserId,
    entityType,
    entityId,
    amountRemoved: amountToRemove,
    originalAmount: amount,
  })
}

/**
 * Handles disputes for subscription charges and overages.
 * Blocks the user/owner associated with the Stripe customer.
 */
async function handleSubscriptionDispute(
  dispute: Stripe.Dispute,
  charge: Stripe.Charge
): Promise<void> {
  const customerId = typeof charge.customer === 'string' ? charge.customer : charge.customer?.id

  if (!customerId) {
    logger.warn('No customer ID in disputed charge', { disputeId: dispute.id })
    return
  }

  // Try to find user by stripeCustomerId (Pro plans)
  const users = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.stripeCustomerId, customerId))
    .limit(1)

  if (users.length > 0) {
    await db
      .update(userStats)
      .set({ billingBlocked: true, billingBlockedReason: 'dispute' })
      .where(eq(userStats.userId, users[0].id))

    logger.warn('Blocked user due to subscription dispute', {
      disputeId: dispute.id,
      userId: users[0].id,
      customerId,
      amount: dispute.amount / 100,
    })
    return
  }

  // Try to find subscription by stripeCustomerId (Team/Enterprise plans)
  const subs = await db
    .select({ referenceId: subscription.referenceId })
    .from(subscription)
    .where(eq(subscription.stripeCustomerId, customerId))
    .limit(1)

  if (subs.length > 0) {
    const orgId = subs[0].referenceId

    const owners = await db
      .select({ userId: member.userId })
      .from(member)
      .where(and(eq(member.organizationId, orgId), eq(member.role, 'owner')))
      .limit(1)

    if (owners.length > 0) {
      await db
        .update(userStats)
        .set({ billingBlocked: true, billingBlockedReason: 'dispute' })
        .where(eq(userStats.userId, owners[0].userId))

      logger.warn('Blocked org owner due to subscription dispute', {
        disputeId: dispute.id,
        ownerId: owners[0].userId,
        organizationId: orgId,
        customerId,
        amount: dispute.amount / 100,
      })
    }
    return
  }

  logger.warn('Could not find user for disputed charge', {
    disputeId: dispute.id,
    customerId,
    amount: dispute.amount / 100,
  })
}

/**
 * Handles dispute resolution (won/lost/expired).
 * Users blocked due to disputes remain blocked until support manually unblocks them.
 * This just logs the outcome for support reference.
 */
export async function handleDisputeClosed(event: Stripe.Event): Promise<void> {
  const dispute = event.data.object as Stripe.Dispute

  // Dispute users stay blocked regardless of outcome - they must contact support
  logger.info('Dispute closed - user remains blocked until support review', {
    disputeId: dispute.id,
    status: dispute.status,
    amount: dispute.amount / 100,
    reason: dispute.reason,
  })
}
