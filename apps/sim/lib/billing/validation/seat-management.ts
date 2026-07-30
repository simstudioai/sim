import { db } from '@sim/db'
import { invitation, member, organization, subscription } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, count, eq, gt, ne } from 'drizzle-orm'
import { getOrganizationSubscription } from '@/lib/billing/core/billing'
import { resolveEnterpriseMetadataIntent } from '@/lib/billing/enterprise-outbox'
import { isEnterprise, isFree } from '@/lib/billing/plan-helpers'
import { getEffectiveSeats } from '@/lib/billing/subscriptions/utils'
import { OUTBOX_EVENT_TYPES } from '@/lib/billing/webhooks/outbox-handlers'
import { isBillingEnabled } from '@/lib/core/config/env-flags'
import { hasInflightOutboxEvent } from '@/lib/core/outbox/service'
import type { DbOrTx } from '@/lib/db/types'

const logger = createLogger('SeatManagement')

interface SeatValidationResult {
  canInvite: boolean
  reason?: string
  currentSeats: number
  maxSeats: number
  availableSeats: number
}

interface OrganizationSeatInfo {
  organizationId: string
  organizationName: string
  currentSeats: number
  maxSeats: number
  availableSeats: number
  subscriptionPlan: string
  canAddSeats: boolean
}

interface ValidateSeatOptions {
  excludePendingInvitationId?: string
}

/**
 * Counts the pending invitations that stand to become seats.
 *
 * The single definition of that predicate: still `pending`, not yet expired, and
 * internal — external collaborators never take a seat. Every seat number in the
 * product derives from this one count so no two surfaces can drift.
 */
export async function countPendingSeatInvitations(
  organizationId: string,
  executor: DbOrTx = db,
  excludePendingInvitationId?: string
): Promise<number> {
  const filters = [
    eq(invitation.organizationId, organizationId),
    eq(invitation.status, 'pending'),
    ne(invitation.membershipIntent, 'external'),
    gt(invitation.expiresAt, new Date()),
  ]
  if (excludePendingInvitationId) {
    filters.push(ne(invitation.id, excludePendingInvitationId))
  }
  const [row] = await executor
    .select({ count: count() })
    .from(invitation)
    .where(and(...filters))
  return row?.count ?? 0
}

/**
 * Resolves the organization's seat capacity, honouring an Enterprise seat
 * change that is still in flight to Stripe.
 */
async function resolveSeatCapacity(
  organizationSubscription: { id: string; plan: string; metadata?: unknown } & Record<
    string,
    unknown
  >,
  executor: DbOrTx = db
): Promise<number> {
  const canonicalSeats = getEffectiveSeats(organizationSubscription)
  if (!isEnterprise(organizationSubscription.plan)) return canonicalSeats
  const intent = await resolveEnterpriseMetadataIntent(
    executor,
    organizationSubscription.id,
    organizationSubscription.metadata
  )
  return intent?.effectiveSeatCapacity ?? canonicalSeats
}

/**
 * Whether the plan has a seat cap that can actually be exhausted.
 *
 * Only Enterprise does. Team seats are billed per member and grown on demand,
 * so its `subscription.seats` tracks the current member count rather than a
 * ceiling — comparing usage against it would always read as "full". Surfaces
 * that gate or visualise remaining capacity must branch on this.
 */
export function planHasFixedSeatCap(plan: string | undefined | null): boolean {
  return isEnterprise(plan)
}

/**
 * Derives the seat figures every surface should report, from one rule.
 *
 * `usedSeats` stays members + pending so the wire meaning is unchanged, while
 * the two components are exposed separately because the UI legitimately needs
 * to distinguish "occupied" from "promised". `availableSeats` is only meaningful
 * under a fixed cap, and is clamped at zero so an elastic plan can never report
 * negative headroom.
 */
export function computeSeatUsage({
  memberSeats,
  pendingSeats,
  totalSeats,
  hasFixedSeatCap,
}: {
  memberSeats: number
  pendingSeats: number
  totalSeats: number
  hasFixedSeatCap: boolean
}): {
  memberSeats: number
  pendingSeats: number
  usedSeats: number
  totalSeats: number
  availableSeats: number
  hasFixedSeatCap: boolean
} {
  const usedSeats = memberSeats + pendingSeats
  return {
    memberSeats,
    pendingSeats,
    usedSeats,
    totalSeats,
    availableSeats: Math.max(0, totalSeats - usedSeats),
    hasFixedSeatCap,
  }
}

export async function validateSeatAvailability(
  organizationId: string,
  additionalSeats = 1,
  options: ValidateSeatOptions = {}
): Promise<SeatValidationResult> {
  try {
    if (!isBillingEnabled) {
      const [memberCount, pendingSeats] = await Promise.all([
        db.select({ count: count() }).from(member).where(eq(member.organizationId, organizationId)),
        countPendingSeatInvitations(organizationId),
      ])
      return {
        canInvite: true,
        currentSeats: (memberCount[0]?.count ?? 0) + pendingSeats,
        maxSeats: Number.MAX_SAFE_INTEGER,
        availableSeats: Number.MAX_SAFE_INTEGER,
      }
    }

    const subscription = await getOrganizationSubscription(organizationId)

    if (!subscription) {
      return {
        canInvite: false,
        reason: 'No active subscription found',
        currentSeats: 0,
        maxSeats: 0,
        availableSeats: 0,
      }
    }

    if (isFree(subscription.plan)) {
      return {
        canInvite: false,
        reason: 'Organization features require a paid plan',
        currentSeats: 0,
        maxSeats: 0,
        availableSeats: 0,
      }
    }

    const [memberCount, pendingSeats, maxSeats] = await Promise.all([
      db.select({ count: count() }).from(member).where(eq(member.organizationId, organizationId)),
      countPendingSeatInvitations(organizationId, db, options.excludePendingInvitationId),
      resolveSeatCapacity(subscription),
    ])

    const {
      usedSeats: currentSeats,
      availableSeats,
      hasFixedSeatCap,
    } = computeSeatUsage({
      memberSeats: memberCount[0]?.count ?? 0,
      pendingSeats,
      totalSeats: maxSeats,
      hasFixedSeatCap: planHasFixedSeatCap(subscription.plan),
    })
    /**
     * Only a fixed cap can refuse an invite. Team seats are provisioned when the
     * invitee accepts, so there is nothing to run out of at invite time.
     */
    const canInvite = !hasFixedSeatCap || availableSeats >= additionalSeats

    const result: SeatValidationResult = {
      canInvite,
      currentSeats,
      maxSeats,
      availableSeats,
    }

    if (!canInvite) {
      if (additionalSeats === 1) {
        result.reason = `No available seats. Currently using ${currentSeats} of ${maxSeats} seats.`
      } else {
        result.reason = `Not enough available seats. Need ${additionalSeats} seats, but only ${availableSeats} available.`
      }
    }

    logger.debug('Seat validation result', {
      organizationId,
      additionalSeats,
      result,
    })

    return result
  } catch (error) {
    logger.error('Failed to validate seat availability', { organizationId, additionalSeats, error })
    return {
      canInvite: false,
      reason: 'Failed to check seat availability',
      currentSeats: 0,
      maxSeats: 0,
      availableSeats: 0,
    }
  }
}

/**
 * Get comprehensive seat information for an organization
 */
export async function getOrganizationSeatInfo(
  organizationId: string
): Promise<OrganizationSeatInfo | null> {
  try {
    const organizationData = await db
      .select({
        id: organization.id,
        name: organization.name,
      })
      .from(organization)
      .where(eq(organization.id, organizationId))
      .limit(1)

    if (organizationData.length === 0) {
      return null
    }

    const [memberCountRow] = await db
      .select({ count: count() })
      .from(member)
      .where(eq(member.organizationId, organizationId))

    const memberSeats = memberCountRow?.count ?? 0
    const pendingSeats = await countPendingSeatInvitations(organizationId)
    const currentSeats = memberSeats + pendingSeats

    if (!isBillingEnabled) {
      return {
        organizationId,
        organizationName: organizationData[0].name,
        currentSeats,
        maxSeats: Number.MAX_SAFE_INTEGER,
        availableSeats: Number.MAX_SAFE_INTEGER,
        subscriptionPlan: 'billing_disabled',
        canAddSeats: false,
      }
    }

    const subscription = await getOrganizationSubscription(organizationId)

    if (!subscription) {
      return null
    }

    const maxSeats = await resolveSeatCapacity(subscription)
    const { availableSeats } = computeSeatUsage({
      memberSeats,
      pendingSeats,
      totalSeats: maxSeats,
      hasFixedSeatCap: planHasFixedSeatCap(subscription.plan),
    })

    return {
      organizationId,
      organizationName: organizationData[0].name,
      currentSeats,
      maxSeats,
      availableSeats,
      subscriptionPlan: subscription.plan,
      canAddSeats: !isEnterprise(subscription.plan),
    }
  } catch (error) {
    logger.error('Failed to get organization seat info', { organizationId, error })
    return null
  }
}

/**
 * Get seat usage analytics for an organization
 */
export async function getOrganizationSeatAnalytics(organizationId: string) {
  try {
    const seatInfo = await getOrganizationSeatInfo(organizationId)

    if (!seatInfo) {
      return null
    }

    const utilizationRate =
      seatInfo.maxSeats > 0 ? (seatInfo.currentSeats / seatInfo.maxSeats) * 100 : 0

    // Member activity analytics (active/inactive counts, memberActivity) were
    // derived from userStats.lastActive, which is no longer written. Dropped
    // rather than report frozen data; reintroduce with a real activity source.
    return {
      ...seatInfo,
      utilizationRate: Math.round(utilizationRate * 100) / 100,
    }
  } catch (error) {
    logger.error('Failed to get organization seat analytics', { organizationId, error })
    return null
  }
}

/**
 * Sync seat count from Stripe subscription quantity. Used by webhook handlers
 * to keep the local DB in sync with Stripe. No-ops while a DB→Stripe seat-sync
 * is still in flight for the subscription, so a stale webhook never clobbers a
 * DB seat change that hasn't been pushed yet (DB is the source of truth).
 */
export async function syncSeatsFromStripeQuantity(
  subscriptionId: string,
  currentSeats: number | null,
  stripeQuantity: number
): Promise<{ synced: boolean; previousSeats: number | null; newSeats: number }> {
  const effectiveCurrentSeats = currentSeats ?? 0

  // Only update if quantity differs
  if (stripeQuantity === effectiveCurrentSeats) {
    return {
      synced: false,
      previousSeats: effectiveCurrentSeats,
      newSeats: stripeQuantity,
    }
  }

  // The DB is the source of truth for Team seats; we push the DB value to
  // Stripe asynchronously via the seat-sync outbox. While that sync is still in
  // flight the DB is intentionally ahead of Stripe, so skip this Stripe-to-DB
  // sync — otherwise a stale customer.subscription.updated webhook could clobber
  // the not-yet-pushed value (e.g. revert a just-removed member's seat).
  const seatSyncInFlight = await hasInflightOutboxEvent(
    OUTBOX_EVENT_TYPES.STRIPE_SYNC_SUBSCRIPTION_SEATS,
    'subscriptionId',
    subscriptionId
  )
  if (seatSyncInFlight) {
    logger.info('Skipping Stripe seat sync; a seat-sync to Stripe is still in flight', {
      subscriptionId,
      stripeQuantity,
      currentSeats: effectiveCurrentSeats,
    })
    return {
      synced: false,
      previousSeats: effectiveCurrentSeats,
      newSeats: effectiveCurrentSeats,
    }
  }

  try {
    await db
      .update(subscription)
      .set({ seats: stripeQuantity })
      .where(eq(subscription.id, subscriptionId))

    logger.info('Synced seat count from Stripe', {
      subscriptionId,
      previousSeats: effectiveCurrentSeats,
      newSeats: stripeQuantity,
    })

    return {
      synced: true,
      previousSeats: effectiveCurrentSeats,
      newSeats: stripeQuantity,
    }
  } catch (error) {
    logger.error('Failed to sync seat count from Stripe', {
      subscriptionId,
      stripeQuantity,
      error,
    })
    throw error
  }
}
