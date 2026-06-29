import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { member, subscription, user, userStats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import type Stripe from 'stripe'
import { blockOrgMembers, unblockOrgMembers } from '@/lib/billing'
import { requireStripeClient } from '@/lib/billing/stripe-client'
import { captureServerEvent } from '@/lib/posthog/server'

const logger = createLogger('DisputeWebhooks')

async function getCustomerIdFromDispute(dispute: Stripe.Dispute): Promise<string | null> {
  const chargeId = typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id
  if (!chargeId) return null

  const stripe = requireStripeClient()
  const charge = await stripe.charges.retrieve(chargeId)
  return typeof charge.customer === 'string' ? charge.customer : (charge.customer?.id ?? null)
}

async function getOrganizationOwnerId(organizationId: string): Promise<string | null> {
  try {
    const rows = await db
      .select({ userId: member.userId })
      .from(member)
      .where(and(eq(member.organizationId, organizationId), eq(member.role, 'owner')))
      .limit(1)
    return rows[0]?.userId ?? null
  } catch (error) {
    logger.warn('Failed to resolve organization owner for dispute audit', { organizationId, error })
    return null
  }
}

/**
 * Record audit + PostHog instrumentation for a charge dispute money event.
 * `actorId` must be the responsible user (org owner for org-scoped charges).
 */
function recordDisputeInstrumentation(
  status: 'opened' | 'closed',
  dispute: Stripe.Dispute,
  customerId: string,
  actorId: string,
  entity: { type: 'user' | 'organization'; id: string }
): void {
  const amount = dispute.amount / 100
  recordAudit({
    actorId,
    action:
      status === 'opened' ? AuditAction.CHARGE_DISPUTE_OPENED : AuditAction.CHARGE_DISPUTE_CLOSED,
    resourceType: AuditResourceType.BILLING,
    resourceId: dispute.id,
    description: `Charge dispute ${status} for $${amount.toFixed(2)} (${dispute.reason})`,
    metadata: {
      entityType: entity.type,
      entityId: entity.id,
      customerId,
      amount,
      currency: dispute.currency,
      reason: dispute.reason,
      status: dispute.status,
    },
  })
  captureServerEvent(actorId, 'charge_disputed', {
    amount,
    currency: dispute.currency,
    reason: dispute.reason,
    status,
    entity_type: entity.type,
    reference_id: entity.id,
  })
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

    recordDisputeInstrumentation('opened', dispute, customerId, users[0].id, {
      type: 'user',
      id: users[0].id,
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

    const actorId = (await getOrganizationOwnerId(orgId)) ?? orgId
    recordDisputeInstrumentation('opened', dispute, customerId, actorId, {
      type: 'organization',
      id: orgId,
    })
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

  const customerId = await getCustomerIdFromDispute(dispute)
  if (!customerId) {
    return
  }

  // Unblock only when we won or the warning closed without a full dispute; a
  // 'lost' dispute keeps the customer blocked (they owe us). The close is
  // audited in every case so the chargeback trail is complete — `dispute.status`
  // in the metadata distinguishes the outcome.
  const shouldUnblock = dispute.status === 'won' || dispute.status === 'warning_closed'

  const users = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.stripeCustomerId, customerId))
    .limit(1)

  if (users.length > 0) {
    if (shouldUnblock) {
      await db
        .update(userStats)
        .set({ billingBlocked: false, billingBlockedReason: null })
        .where(
          and(eq(userStats.userId, users[0].id), eq(userStats.billingBlockedReason, 'dispute'))
        )
    }
    logger.info('Dispute closed for user', {
      disputeId: dispute.id,
      userId: users[0].id,
      status: dispute.status,
      unblocked: shouldUnblock,
    })

    recordDisputeInstrumentation('closed', dispute, customerId, users[0].id, {
      type: 'user',
      id: users[0].id,
    })
    return
  }

  const subs = await db
    .select({ referenceId: subscription.referenceId })
    .from(subscription)
    .where(eq(subscription.stripeCustomerId, customerId))
    .limit(1)

  if (subs.length > 0) {
    const orgId = subs[0].referenceId
    if (shouldUnblock) {
      await unblockOrgMembers(orgId, 'dispute')
    }
    logger.info('Dispute closed for organization', {
      disputeId: dispute.id,
      organizationId: orgId,
      status: dispute.status,
      unblocked: shouldUnblock,
    })

    const actorId = (await getOrganizationOwnerId(orgId)) ?? orgId
    recordDisputeInstrumentation('closed', dispute, customerId, actorId, {
      type: 'organization',
      id: orgId,
    })
  }
}
