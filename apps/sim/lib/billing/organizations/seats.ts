import { db } from '@sim/db'
import { invitation, member, subscription } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, count, eq, gt, inArray, ne } from 'drizzle-orm'
import { isOrganizationBillingBlocked } from '@/lib/billing/core/access'
import { isTeam } from '@/lib/billing/plan-helpers'
import { USABLE_SUBSCRIPTION_STATUSES } from '@/lib/billing/subscriptions/utils'
import { OUTBOX_EVENT_TYPES } from '@/lib/billing/webhooks/outbox-handlers'
import { isBillingEnabled } from '@/lib/core/config/feature-flags'
import { enqueueOutboxEvent } from '@/lib/core/outbox/service'

const logger = createLogger('OrganizationSeats')

export interface ReduceOrganizationSeatsResult {
  reduced: boolean
  previousSeats?: number
  seats?: number
  reason?: string
  outboxEventId?: string
}

interface ReduceOrganizationSeatsByOneParams {
  organizationId: string
  actorUserId: string
  removedUserId: string
}

export async function reduceOrganizationSeatsByOne({
  organizationId,
  actorUserId,
  removedUserId,
}: ReduceOrganizationSeatsByOneParams): Promise<ReduceOrganizationSeatsResult> {
  if (!isBillingEnabled) {
    return { reduced: false, reason: 'Billing is not enabled' }
  }

  return db.transaction(async (tx) => {
    const [orgSubscription] = await tx
      .select()
      .from(subscription)
      .where(
        and(
          eq(subscription.referenceId, organizationId),
          inArray(subscription.status, USABLE_SUBSCRIPTION_STATUSES)
        )
      )
      .for('update')
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

    const [memberCountRow] = await tx
      .select({ count: count() })
      .from(member)
      .where(eq(member.organizationId, organizationId))

    const [pendingCountRow] = await tx
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

    await tx
      .update(subscription)
      .set({ seats: nextSeats })
      .where(eq(subscription.id, orgSubscription.id))

    const outboxEventId = await enqueueOutboxEvent(
      tx,
      OUTBOX_EVENT_TYPES.STRIPE_SYNC_SUBSCRIPTION_SEATS,
      {
        subscriptionId: orgSubscription.id,
        reason: 'member-removed-seat-reduction',
      }
    )

    logger.info('Reduced organization seats after member removal', {
      organizationId,
      actorUserId,
      removedUserId,
      previousSeats: currentSeats,
      seats: nextSeats,
      outboxEventId,
    })

    return { reduced: true, previousSeats: currentSeats, seats: nextSeats, outboxEventId }
  })
}
