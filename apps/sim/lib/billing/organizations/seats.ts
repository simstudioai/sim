import { db } from '@sim/db'
import { invitation, member, subscription } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, count, eq, gt, inArray, ne } from 'drizzle-orm'
import { isOrganizationBillingBlocked } from '@/lib/billing/core/access'
import { isTeam } from '@/lib/billing/plan-helpers'
import { requireStripeClient } from '@/lib/billing/stripe-client'
import {
  hasUsableSubscriptionStatus,
  USABLE_SUBSCRIPTION_STATUSES,
} from '@/lib/billing/subscriptions/utils'
import { syncSeatsFromStripeQuantity } from '@/lib/billing/validation/seat-management'
import { isBillingEnabled } from '@/lib/core/config/feature-flags'

const logger = createLogger('OrganizationSeats')

export interface ReduceOrganizationSeatsResult {
  reduced: boolean
  previousSeats?: number
  seats?: number
  reason?: string
}

export async function reduceOrganizationSeatsByOne(
  organizationId: string,
  userId: string
): Promise<ReduceOrganizationSeatsResult> {
  if (!isBillingEnabled) {
    return { reduced: false, reason: 'Billing is not enabled' }
  }

  const [orgSubscription] = await db
    .select()
    .from(subscription)
    .where(
      and(
        eq(subscription.referenceId, organizationId),
        inArray(subscription.status, USABLE_SUBSCRIPTION_STATUSES)
      )
    )
    .limit(1)

  if (!orgSubscription) {
    return { reduced: false, reason: 'No active subscription found' }
  }

  if (await isOrganizationBillingBlocked(organizationId)) {
    return { reduced: false, reason: 'An active subscription is required' }
  }

  if (!isTeam(orgSubscription.plan)) {
    return { reduced: false, reason: 'Seat changes are only available for Team plans' }
  }

  if (!orgSubscription.stripeSubscriptionId) {
    return { reduced: false, reason: 'No Stripe subscription found for this organization' }
  }

  const currentSeats = orgSubscription.seats || 1
  if (currentSeats <= 1) {
    return {
      reduced: false,
      previousSeats: currentSeats,
      seats: currentSeats,
      reason: 'Minimum 1 seat required',
    }
  }

  const [memberCountRow] = await db
    .select({ count: count() })
    .from(member)
    .where(eq(member.organizationId, organizationId))

  const [pendingCountRow] = await db
    .select({ count: count() })
    .from(invitation)
    .where(
      and(
        eq(invitation.organizationId, organizationId),
        eq(invitation.status, 'pending'),
        ne(invitation.membershipIntent, 'external'),
        gt(invitation.expiresAt, new Date())
      )
    )

  const occupiedSeats = (memberCountRow?.count ?? 0) + (pendingCountRow?.count ?? 0)
  const nextSeats = currentSeats - 1

  if (nextSeats < occupiedSeats) {
    return {
      reduced: false,
      previousSeats: currentSeats,
      seats: currentSeats,
      reason: `Cannot reduce seats below current occupancy (${occupiedSeats}).`,
    }
  }

  const stripe = requireStripeClient()
  const stripeSubscription = await stripe.subscriptions.retrieve(
    orgSubscription.stripeSubscriptionId
  )

  if (!hasUsableSubscriptionStatus(stripeSubscription.status)) {
    return {
      reduced: false,
      previousSeats: currentSeats,
      seats: currentSeats,
      reason: 'Stripe subscription is not active',
    }
  }

  const subscriptionItem = stripeSubscription.items.data[0]
  if (!subscriptionItem) {
    return {
      reduced: false,
      previousSeats: currentSeats,
      seats: currentSeats,
      reason: 'No subscription item found in Stripe subscription',
    }
  }

  const updatedSubscription = await stripe.subscriptions.update(
    orgSubscription.stripeSubscriptionId,
    {
      items: [
        {
          id: subscriptionItem.id,
          quantity: nextSeats,
        },
      ],
      proration_behavior: 'always_invoice',
    },
    {
      idempotencyKey: `seats-reduce-member-removal:${orgSubscription.stripeSubscriptionId}:${nextSeats}`,
    }
  )

  const updatedSeats = updatedSubscription.items.data[0]?.quantity ?? nextSeats
  await syncSeatsFromStripeQuantity(orgSubscription.id, orgSubscription.seats, updatedSeats)

  logger.info('Reduced organization seats after member removal', {
    organizationId,
    userId,
    previousSeats: currentSeats,
    seats: updatedSeats,
  })

  return { reduced: true, previousSeats: currentSeats, seats: updatedSeats }
}
