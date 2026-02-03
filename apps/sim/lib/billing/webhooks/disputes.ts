import { db } from '@sim/db'
import { subscription, user, userStats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import type Stripe from 'stripe'
import { blockOrgMembers, unblockOrgMembers } from '@/lib/billing'
import { requireStripeClient } from '@/lib/billing/stripe-client'

const logger = createLogger('DisputeWebhooks')

async function getCustomerIdFromDispute(dispute: Stripe.Dispute): Promise<string | null> {
  const chargeId = typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id
  if (!chargeId) return null

  const stripe = requireStripeClient()
  const charge = await stripe.charges.retrieve(chargeId)
  return typeof charge.customer === 'string' ? charge.customer : (charge.customer?.id ?? null)
}

/**
 * Handles charge.dispute.created - blocks the responsible user
 */
export async function handleChargeDispute(event: Stripe.Event): Promise<void> {
  const dispute = event.data.object as Stripe.Dispute

  const customerId = await getCustomerIdFromDispute(dispute)
  if (!customerId) {
    logger.warn('No customer ID found in dispute', { disputeId: dispute.id })
    return
  }

  // Find user by stripeCustomerId (Pro plans)
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

    logger.warn('Blocked user due to dispute', {
      disputeId: dispute.id,
      userId: users[0].id,
    })
    return
  }

  // Find subscription by stripeCustomerId (Team/Enterprise)
  const subs = await db
    .select({ referenceId: subscription.referenceId })
    .from(subscription)
    .where(eq(subscription.stripeCustomerId, customerId))
    .limit(1)

  if (subs.length > 0) {
    const orgId = subs[0].referenceId
    const memberCount = await blockOrgMembers(orgId, 'dispute')

    if (memberCount > 0) {
      logger.warn('Blocked all org members due to dispute', {
        disputeId: dispute.id,
        organizationId: orgId,
        memberCount,
      })
    }
  }
}

/**
 * Handles charge.dispute.closed - unblocks user if dispute was won or warning closed
 *
 * Status meanings:
 * - 'won': Merchant won, customer's chargeback denied → unblock
 * - 'lost': Customer won, money refunded → stay blocked (they owe us)
 * - 'warning_closed': Pre-dispute inquiry closed without chargeback → unblock (false alarm)
 */
export async function handleDisputeClosed(event: Stripe.Event): Promise<void> {
  const dispute = event.data.object as Stripe.Dispute

  // Only unblock if we won or the warning was closed without a full dispute
  const shouldUnblock = dispute.status === 'won' || dispute.status === 'warning_closed'

  if (!shouldUnblock) {
    logger.info('Dispute resolved against us, user remains blocked', {
      disputeId: dispute.id,
      status: dispute.status,
    })
    return
  }

  const customerId = await getCustomerIdFromDispute(dispute)
  if (!customerId) {
    return
  }

  // Find and unblock user (Pro plans) - only if blocked for dispute, not other reasons
  const users = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.stripeCustomerId, customerId))
    .limit(1)

  if (users.length > 0) {
    await db
      .update(userStats)
      .set({ billingBlocked: false, billingBlockedReason: null })
      .where(and(eq(userStats.userId, users[0].id), eq(userStats.billingBlockedReason, 'dispute')))

    logger.info('Unblocked user after dispute resolved in our favor', {
      disputeId: dispute.id,
      userId: users[0].id,
      status: dispute.status,
    })
    return
  }

  // Find and unblock all org members (Team/Enterprise) - consistent with payment success
  const subs = await db
    .select({ referenceId: subscription.referenceId })
    .from(subscription)
    .where(eq(subscription.stripeCustomerId, customerId))
    .limit(1)

  if (subs.length > 0) {
    const orgId = subs[0].referenceId
    const memberCount = await unblockOrgMembers(orgId, 'dispute')

    logger.info('Unblocked all org members after dispute resolved in our favor', {
      disputeId: dispute.id,
      organizationId: orgId,
      memberCount,
      status: dispute.status,
    })
  }
}
