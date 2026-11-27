import { db } from '@sim/db'
import { invitation, member, organization, subscription, user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, count, eq, gt, ne, sql } from 'drizzle-orm'
import { getOrganizationSubscription } from '@/lib/billing/core/billing'
import { resolveEnterpriseMetadataIntent } from '@/lib/billing/enterprise-outbox'
import { isEnterprise, isFree } from '@/lib/billing/plan-helpers'
import { getEffectiveSeats } from '@/lib/billing/subscriptions/utils'
import { OUTBOX_EVENT_TYPES } from '@/lib/billing/webhooks/outbox-events'
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
  executor?: DbOrTx
}

/**
 * Counts the pending invitations that stand to become seats.
 *
 * The single definition of that predicate: still `pending`, not yet expired,
 * internal, and addressed to somebody who is not already a member of any
 * organization. Existing organization members cannot consume a destination
 * seat: workspace invitations remain external and organization invitations are
 * rejected. Every seat number in the product derives from this one count so no
 * two surfaces can drift.
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
    // Membership is intentionally not scoped to the invitation's destination.
    // A user who belongs to any organization cannot consume this seat under the
    // acceptance semantics, so reserving one would overstate Enterprise usage.
    sql<boolean>`NOT EXISTS (
      SELECT 1
      FROM ${member}
      INNER JOIN ${user} ON ${user.id} = ${member.userId}
      WHERE LOWER(BTRIM(${user.email})) = LOWER(BTRIM(${invitation.email}))
    )`,
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
 * How an organization's seats bound membership:
 * - `fixed`: an Enterprise contract outside self-serve, a cap that can actually be exhausted;
 * - `baseline`: a self-serve Enterprise contract, whose members outgrow its seats and true up;
 * - `on-demand`: Team, billed per member, so `subscription.seats` tracks the member count rather
 *   than a ceiling.
 */
export type SeatCapKind = 'fixed' | 'baseline' | 'on-demand'

/**
 * The organization's seats and how they bound membership, honouring an Enterprise change still
 * in flight to Stripe. Every surface that admits members or gates remaining capacity branches on
 * `kind`.
 */
export async function resolveSeatCap(
  organizationSubscription: { id: string; plan: string; metadata?: unknown } & Record<
    string,
    unknown
  >,
  executor: DbOrTx = db
): Promise<{ seats: number; kind: SeatCapKind }> {
  const canonicalSeats = getEffectiveSeats(organizationSubscription)
  if (!isEnterprise(organizationSubscription.plan)) {
    return { seats: canonicalSeats, kind: 'on-demand' }
  }
  const intent = await resolveEnterpriseMetadataIntent(
    executor,
    organizationSubscription.id,
    organizationSubscription.metadata
  )
  return {
    seats: intent.effectiveSeatCapacity ?? canonicalSeats,
    kind: intent.seatsUncapped ? 'baseline' : 'fixed',
  }
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
    const executor = options.executor ?? db
    if (!isBillingEnabled) {
      const [memberCount, pendingSeats] = await Promise.all([
        executor
          .select({ count: count() })
          .from(member)
          .where(eq(member.organizationId, organizationId)),
        countPendingSeatInvitations(organizationId, executor),
      ])
      return {
        canInvite: true,
        currentSeats: (memberCount[0]?.count ?? 0) + pendingSeats,
        maxSeats: Number.MAX_SAFE_INTEGER,
        availableSeats: Number.MAX_SAFE_INTEGER,
      }
    }

    const subscription = await getOrganizationSubscription(organizationId, { executor })

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

    const [memberCount, pendingSeats, seatCap] = await Promise.all([
      executor
        .select({ count: count() })
        .from(member)
        .where(eq(member.organizationId, organizationId)),
      countPendingSeatInvitations(organizationId, executor, options.excludePendingInvitationId),
      resolveSeatCap(subscription, executor),
    ])
    const maxSeats = seatCap.seats

    const {
      usedSeats: currentSeats,
      availableSeats,
      hasFixedSeatCap,
    } = computeSeatUsage({
      memberSeats: memberCount[0]?.count ?? 0,
      pendingSeats,
      totalSeats: maxSeats,
      hasFixedSeatCap: seatCap.kind === 'fixed',
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

    const seatCap = await resolveSeatCap(subscription)
    const maxSeats = seatCap.seats
    const { availableSeats } = computeSeatUsage({
      memberSeats,
      pendingSeats,
      totalSeats: maxSeats,
      hasFixedSeatCap: seatCap.kind === 'fixed',
    })

    return {
      organizationId,
      organizationName: organizationData[0].name,
      currentSeats,
      maxSeats,
      availableSeats,
      subscriptionPlan: subscription.plan,
      canAddSeats: seatCap.kind !== 'fixed',
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
