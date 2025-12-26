import { db } from '@sim/db'
import { member, subscription, user, userStats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import type Stripe from 'stripe'
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

      logger.warn('Blocked org owner due to dispute', {
        disputeId: dispute.id,
        ownerId: owners[0].userId,
        organizationId: orgId,
      })
    }
  }
}

/**
 * Handles charge.dispute.closed - unblocks user if dispute was won
 */
export async function handleDisputeClosed(event: Stripe.Event): Promise<void> {
  const dispute = event.data.object as Stripe.Dispute

  if (dispute.status !== 'won') {
    logger.info('Dispute not won, user remains blocked', {
      disputeId: dispute.id,
      status: dispute.status,
    })
    return
  }

  const customerId = await getCustomerIdFromDispute(dispute)
  if (!customerId) {
    return
  }

  // Find and unblock user (Pro plans)
  const users = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.stripeCustomerId, customerId))
    .limit(1)

  if (users.length > 0) {
    await db
      .update(userStats)
      .set({ billingBlocked: false, billingBlockedReason: null })
      .where(eq(userStats.userId, users[0].id))

    logger.info('Unblocked user after winning dispute', {
      disputeId: dispute.id,
      userId: users[0].id,
    })
    return
  }

  // Find and unblock org owner (Team/Enterprise)
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
        .set({ billingBlocked: false, billingBlockedReason: null })
        .where(eq(userStats.userId, owners[0].userId))

      logger.info('Unblocked org owner after winning dispute', {
        disputeId: dispute.id,
        ownerId: owners[0].userId,
        organizationId: orgId,
      })
    }
  }
}
