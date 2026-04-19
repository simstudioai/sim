/**
 * Organization Membership Management
 *
 * Shared helpers for adding and removing users from organizations.
 * Used by both regular routes and admin routes to ensure consistent business logic.
 */

import { db } from '@sim/db'
import {
  member,
  organization,
  subscription as subscriptionTable,
  user,
  userStats,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm'
import { syncUsageLimitsFromSubscription } from '@/lib/billing/core/usage'
import { isPaid, sqlIsPro } from '@/lib/billing/plan-helpers'
import { ENTITLED_SUBSCRIPTION_STATUSES } from '@/lib/billing/subscriptions/utils'
import { toDecimal, toNumber } from '@/lib/billing/utils/decimal'
import { validateSeatAvailability } from '@/lib/billing/validation/seat-management'
import { OUTBOX_EVENT_TYPES } from '@/lib/billing/webhooks/outbox-handlers'
import { enqueueOutboxEvent } from '@/lib/core/outbox/service'
import { generateId } from '@/lib/core/utils/uuid'

const logger = createLogger('OrganizationMembership')

export type BillingBlockReason = 'payment_failed' | 'dispute'

/**
 * Get all member user IDs for an organization
 */
export async function getOrgMemberIds(organizationId: string): Promise<string[]> {
  const members = await db
    .select({ userId: member.userId })
    .from(member)
    .where(eq(member.organizationId, organizationId))

  return members.map((m) => m.userId)
}

/**
 * Block all members of an organization for billing reasons
 * Returns the number of members actually blocked
 *
 * Reason priority: dispute > payment_failed
 * A payment_failed block won't overwrite an existing dispute block
 */
export async function blockOrgMembers(
  organizationId: string,
  reason: BillingBlockReason
): Promise<number> {
  const memberIds = await getOrgMemberIds(organizationId)

  if (memberIds.length === 0) {
    return 0
  }

  // Don't overwrite dispute blocks with payment_failed (dispute is higher priority)
  const whereClause =
    reason === 'payment_failed'
      ? and(
          inArray(userStats.userId, memberIds),
          or(ne(userStats.billingBlockedReason, 'dispute'), isNull(userStats.billingBlockedReason))
        )
      : inArray(userStats.userId, memberIds)

  const result = await db
    .update(userStats)
    .set({ billingBlocked: true, billingBlockedReason: reason })
    .where(whereClause)
    .returning({ userId: userStats.userId })

  return result.length
}

/**
 * Unblock all members of an organization blocked for a specific reason
 * Only unblocks members blocked for the specified reason (not other reasons)
 * Returns the number of members actually unblocked
 */
export async function unblockOrgMembers(
  organizationId: string,
  reason: BillingBlockReason
): Promise<number> {
  const memberIds = await getOrgMemberIds(organizationId)

  if (memberIds.length === 0) {
    return 0
  }

  const result = await db
    .update(userStats)
    .set({ billingBlocked: false, billingBlockedReason: null })
    .where(and(inArray(userStats.userId, memberIds), eq(userStats.billingBlockedReason, reason)))
    .returning({ userId: userStats.userId })

  return result.length
}

export interface RestoreProResult {
  restored: boolean
  usageRestored: boolean
  subscriptionId?: string
}

/**
 * Restore a user's personal Pro subscription if it was paused
 * (`cancelAtPeriodEnd = true`) and merge any snapshotted Pro usage back
 * into their current-period usage.
 *
 * All DB mutations run inside a single transaction so partial progress
 * cannot be committed: either both the subscription un-pause and the
 * usage snapshot merge succeed, or neither does. Errors propagate to
 * the caller so webhook handlers can rely on Stripe retry semantics.
 *
 * Idempotent:
 *   - Early returns when the user has no paused Pro subscription, so
 *     re-runs after a successful restore are no-ops.
 *   - The snapshot merge only runs when `proPeriodCostSnapshot > 0`,
 *     so a second call after a prior success (which zeroes the
 *     snapshot) does nothing.
 *
 * Called when:
 *   - A member leaves a team (via `removeUserFromOrganization`).
 *   - A team subscription ends (members stay but get Pro restored).
 */
export async function restoreUserProSubscription(userId: string): Promise<RestoreProResult> {
  const result: RestoreProResult = {
    restored: false,
    usageRestored: false,
  }

  const [personalPro] = await db
    .select()
    .from(subscriptionTable)
    .where(
      and(
        eq(subscriptionTable.referenceId, userId),
        inArray(subscriptionTable.status, ENTITLED_SUBSCRIPTION_STATUSES),
        sqlIsPro(subscriptionTable.plan)
      )
    )
    .limit(1)

  if (!personalPro?.cancelAtPeriodEnd || !personalPro.stripeSubscriptionId) {
    return result
  }

  result.subscriptionId = personalPro.id

  await db.transaction(async (tx) => {
    await tx
      .update(subscriptionTable)
      .set({ cancelAtPeriodEnd: false })
      .where(eq(subscriptionTable.id, personalPro.id))

    await enqueueOutboxEvent(tx, OUTBOX_EVENT_TYPES.STRIPE_SYNC_CANCEL_AT_PERIOD_END, {
      stripeSubscriptionId: personalPro.stripeSubscriptionId,
      subscriptionId: personalPro.id,
      reason: 'member-left-paid-org',
    })

    result.restored = true

    const [stats] = await tx
      .select({
        currentPeriodCost: userStats.currentPeriodCost,
        proPeriodCostSnapshot: userStats.proPeriodCostSnapshot,
      })
      .from(userStats)
      .where(eq(userStats.userId, userId))
      .limit(1)

    if (!stats) {
      return
    }

    const currentNum = toNumber(toDecimal(stats.currentPeriodCost))
    const snapshotNum = toNumber(toDecimal(stats.proPeriodCostSnapshot))

    if (snapshotNum <= 0) {
      return
    }

    const restoredUsage = (currentNum + snapshotNum).toString()

    await tx
      .update(userStats)
      .set({
        currentPeriodCost: restoredUsage,
        proPeriodCostSnapshot: '0',
        proPeriodCostSnapshotAt: null,
      })
      .where(eq(userStats.userId, userId))

    result.usageRestored = true

    logger.info('Restored Pro usage snapshot', {
      userId,
      previousUsage: currentNum,
      snapshotUsage: snapshotNum,
      restoredUsage,
    })
  })

  logger.info('Restored personal Pro subscription (DB committed, Stripe queued)', {
    userId,
    subscriptionId: personalPro.id,
    usageRestored: result.usageRestored,
  })

  return result
}

export interface AddMemberParams {
  userId: string
  organizationId: string
  role: 'admin' | 'member' | 'owner'
  /** Skip Pro snapshot/cancellation logic (default: false) */
  skipBillingLogic?: boolean
  /** Skip seat validation (default: false) */
  skipSeatValidation?: boolean
  /** When provided, the acceptor's own pending invitation is excluded from the seat count during validation. */
  acceptingInvitationId?: string
}

export interface AddMemberResult {
  success: boolean
  memberId?: string
  error?: string
  billingActions: {
    proUsageSnapshotted: boolean
    /**
     * True when this function marked the user's personal Pro for
     * cancellation at period end AND enqueued the Stripe sync via
     * the outbox. Callers should NOT make a Stripe call themselves.
     */
    proCancelledAtPeriodEnd: boolean
  }
}

export interface EnsureMemberResult extends AddMemberResult {
  alreadyMember: boolean
  existingOrgId?: string
}

export interface RemoveMemberParams {
  userId: string
  organizationId: string
  memberId: string
  /** Skip departed usage capture and Pro restoration (default: false) */
  skipBillingLogic?: boolean
}

export interface RemoveMemberResult {
  success: boolean
  error?: string
  billingActions: {
    usageCaptured: number
    proRestored: boolean
    usageRestored: boolean
  }
}

export interface MembershipValidationResult {
  canAdd: boolean
  reason?: string
  existingOrgId?: string
  seatValidation?: {
    currentSeats: number
    maxSeats: number
    availableSeats: number
  }
}

export async function ensureUserInOrganization(
  params: AddMemberParams
): Promise<EnsureMemberResult> {
  const existingMembership = await getUserOrganization(params.userId)

  if (existingMembership?.organizationId === params.organizationId) {
    return {
      success: true,
      memberId: existingMembership.memberId,
      alreadyMember: true,
      billingActions: {
        proUsageSnapshotted: false,
        proCancelledAtPeriodEnd: false,
      },
    }
  }

  if (existingMembership) {
    return {
      success: false,
      alreadyMember: false,
      existingOrgId: existingMembership.organizationId,
      error:
        'User is already a member of another organization. Users can only belong to one organization at a time.',
      billingActions: {
        proUsageSnapshotted: false,
        proCancelledAtPeriodEnd: false,
      },
    }
  }

  const result = await addUserToOrganization(params)

  return {
    ...result,
    alreadyMember: false,
  }
}

/**
 * Validate if a user can be added to an organization.
 * Checks single-org constraint and seat availability.
 */
export async function validateMembershipAddition(
  userId: string,
  organizationId: string,
  options: { acceptingInvitationId?: string } = {}
): Promise<MembershipValidationResult> {
  const [userData] = await db.select({ id: user.id }).from(user).where(eq(user.id, userId)).limit(1)

  if (!userData) {
    return { canAdd: false, reason: 'User not found' }
  }

  const [orgData] = await db
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.id, organizationId))
    .limit(1)

  if (!orgData) {
    return { canAdd: false, reason: 'Organization not found' }
  }

  const existingMemberships = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(eq(member.userId, userId))

  if (existingMemberships.length > 0) {
    const isAlreadyMemberOfThisOrg = existingMemberships.some(
      (m) => m.organizationId === organizationId
    )

    if (isAlreadyMemberOfThisOrg) {
      return { canAdd: false, reason: 'User is already a member of this organization' }
    }

    return {
      canAdd: false,
      reason:
        'User is already a member of another organization. Users can only belong to one organization at a time.',
      existingOrgId: existingMemberships[0].organizationId,
    }
  }

  const seatValidation = await validateSeatAvailability(organizationId, 1, {
    excludePendingInvitationId: options.acceptingInvitationId,
  })
  if (!seatValidation.canInvite) {
    return {
      canAdd: false,
      reason: seatValidation.reason || 'No seats available',
      seatValidation: {
        currentSeats: seatValidation.currentSeats,
        maxSeats: seatValidation.maxSeats,
        availableSeats: seatValidation.availableSeats,
      },
    }
  }

  return {
    canAdd: true,
    seatValidation: {
      currentSeats: seatValidation.currentSeats,
      maxSeats: seatValidation.maxSeats,
      availableSeats: seatValidation.availableSeats,
    },
  }
}

interface PaidOrgJoinBillingActions {
  proUsageSnapshotted: boolean
  proCancelledAtPeriodEnd: boolean
}

/**
 * Applies the billing side-effects of a user joining a paid (Team/Enterprise)
 * organization inside an existing transaction:
 *   - snapshots current Pro usage so new usage attributes to the org;
 *   - marks personal Pro subscription `cancelAtPeriodEnd=true` and enqueues
 *     the Stripe sync via the outbox;
 *   - transfers personal storage bytes into the org's pool.
 *
 * Idempotent: re-running is a no-op when Pro is already flagged cancel-at-period-end
 * and the user's storage is already transferred (zeroed).
 */
async function applyPaidOrgJoinBillingTx(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  userId: string,
  organizationId: string
): Promise<PaidOrgJoinBillingActions> {
  const actions: PaidOrgJoinBillingActions = {
    proUsageSnapshotted: false,
    proCancelledAtPeriodEnd: false,
  }

  const [personalPro] = await tx
    .select()
    .from(subscriptionTable)
    .where(
      and(
        eq(subscriptionTable.referenceId, userId),
        inArray(subscriptionTable.status, ENTITLED_SUBSCRIPTION_STATUSES),
        sqlIsPro(subscriptionTable.plan)
      )
    )
    .limit(1)

  if (personalPro && !personalPro.cancelAtPeriodEnd) {
    const [userStatsRow] = await tx
      .select({ currentPeriodCost: userStats.currentPeriodCost })
      .from(userStats)
      .where(eq(userStats.userId, userId))
      .limit(1)

    if (userStatsRow) {
      const currentProUsage = userStatsRow.currentPeriodCost || '0'

      await tx
        .update(userStats)
        .set({
          proPeriodCostSnapshot: currentProUsage,
          proPeriodCostSnapshotAt: new Date(),
          currentPeriodCost: '0',
          currentPeriodCopilotCost: '0',
        })
        .where(eq(userStats.userId, userId))

      actions.proUsageSnapshotted = true

      logger.info('Snapshotted Pro usage when joining paid org', {
        userId,
        proUsageSnapshot: currentProUsage,
        organizationId,
      })
    }

    await tx
      .update(subscriptionTable)
      .set({ cancelAtPeriodEnd: true })
      .where(eq(subscriptionTable.id, personalPro.id))

    if (personalPro.stripeSubscriptionId) {
      await enqueueOutboxEvent(tx, OUTBOX_EVENT_TYPES.STRIPE_SYNC_CANCEL_AT_PERIOD_END, {
        stripeSubscriptionId: personalPro.stripeSubscriptionId,
        subscriptionId: personalPro.id,
        reason: 'joined-paid-org',
      })
    }

    actions.proCancelledAtPeriodEnd = true

    logger.info('Marked personal Pro for cancellation at period end (Stripe queued)', {
      userId,
      subscriptionId: personalPro.id,
      organizationId,
    })
  }

  const storageRows = await tx
    .select({ storageUsedBytes: userStats.storageUsedBytes })
    .from(userStats)
    .where(eq(userStats.userId, userId))
    .for('update')
    .limit(1)

  const bytesToTransfer = storageRows[0]?.storageUsedBytes ?? 0
  if (bytesToTransfer > 0) {
    await tx
      .update(organization)
      .set({
        storageUsedBytes: sql`${organization.storageUsedBytes} + ${bytesToTransfer}`,
      })
      .where(eq(organization.id, organizationId))

    await tx.update(userStats).set({ storageUsedBytes: 0 }).where(eq(userStats.userId, userId))

    logger.info('Transferred personal storage bytes to org pool on join', {
      userId,
      organizationId,
      bytes: bytesToTransfer,
    })
  }

  return actions
}

/**
 * Re-applies paid-org join billing for a user who is already a member of
 * the organization. Used on re-upgrade after a dormant transition: members
 * kept their org membership but had their personal Pro subscriptions
 * restored (`cancelAtPeriodEnd=false`) during the cancel/downgrade. When
 * the org becomes paid again, those Pros must be re-paused so the user
 * isn't double-billed.
 *
 * No-op when the org has no active Team/Enterprise subscription.
 */
export async function reapplyPaidOrgJoinBillingForExistingMember(
  userId: string,
  organizationId: string
): Promise<PaidOrgJoinBillingActions> {
  return db.transaction(async (tx) => {
    const [orgSub] = await tx
      .select({ plan: subscriptionTable.plan })
      .from(subscriptionTable)
      .where(
        and(
          eq(subscriptionTable.referenceId, organizationId),
          inArray(subscriptionTable.status, ENTITLED_SUBSCRIPTION_STATUSES)
        )
      )
      .limit(1)

    if (!orgSub || !isPaid(orgSub.plan)) {
      return { proUsageSnapshotted: false, proCancelledAtPeriodEnd: false }
    }

    return applyPaidOrgJoinBillingTx(tx, userId, organizationId)
  })
}

/**
 * Add a user to an organization with full billing logic.
 *
 * Handles:
 * - Single organization constraint validation
 * - Seat availability validation
 * - Member record creation
 * - Pro usage snapshot when joining paid team
 * - Pro subscription cancellation at period end
 * - Usage limit sync
 */
export async function addUserToOrganization(params: AddMemberParams): Promise<AddMemberResult> {
  const {
    userId,
    organizationId,
    role,
    skipBillingLogic = false,
    skipSeatValidation = false,
    acceptingInvitationId,
  } = params

  const billingActions: AddMemberResult['billingActions'] = {
    proUsageSnapshotted: false,
    proCancelledAtPeriodEnd: false,
  }

  try {
    if (!skipSeatValidation) {
      const validation = await validateMembershipAddition(userId, organizationId, {
        acceptingInvitationId,
      })
      if (!validation.canAdd) {
        return { success: false, error: validation.reason, billingActions }
      }
    } else {
      const existingMemberships = await db
        .select({ organizationId: member.organizationId })
        .from(member)
        .where(eq(member.userId, userId))

      if (existingMemberships.length > 0) {
        const isAlreadyMemberOfThisOrg = existingMemberships.some(
          (m) => m.organizationId === organizationId
        )

        if (isAlreadyMemberOfThisOrg) {
          return {
            success: false,
            error: 'User is already a member of this organization',
            billingActions,
          }
        }

        return {
          success: false,
          error:
            'User is already a member of another organization. Users can only belong to one organization at a time.',
          billingActions,
        }
      }
    }

    let memberId = ''

    await db.transaction(async (tx) => {
      memberId = generateId()
      await tx.insert(member).values({
        id: memberId,
        userId,
        organizationId,
        role,
        createdAt: new Date(),
      })

      if (skipBillingLogic) {
        return
      }

      const [orgSub] = await tx
        .select({ plan: subscriptionTable.plan })
        .from(subscriptionTable)
        .where(
          and(
            eq(subscriptionTable.referenceId, organizationId),
            inArray(subscriptionTable.status, ENTITLED_SUBSCRIPTION_STATUSES)
          )
        )
        .limit(1)

      if (!orgSub || !isPaid(orgSub.plan)) {
        return
      }

      const joinBillingActions = await applyPaidOrgJoinBillingTx(tx, userId, organizationId)
      billingActions.proUsageSnapshotted = joinBillingActions.proUsageSnapshotted
      billingActions.proCancelledAtPeriodEnd = joinBillingActions.proCancelledAtPeriodEnd
    })

    logger.info('Added user to organization', {
      userId,
      organizationId,
      role,
      memberId,
      billingActions,
    })

    return { success: true, memberId, billingActions }
  } catch (error) {
    logger.error('Failed to add user to organization', { userId, organizationId, error })
    return { success: false, error: 'Failed to add user to organization', billingActions }
  }
}

/**
 * Remove a user from an organization with full billing logic.
 *
 * Handles:
 * - Owner removal prevention
 * - Departed member usage capture
 * - Member record deletion
 * - Pro subscription restoration when leaving a paid team
 * - Pro usage restoration from snapshot
 *
 * Note: Users can only belong to one organization at a time.
 */
export async function removeUserFromOrganization(
  params: RemoveMemberParams
): Promise<RemoveMemberResult> {
  const { userId, organizationId, memberId, skipBillingLogic = false } = params

  const billingActions = {
    usageCaptured: 0,
    proRestored: false,
    usageRestored: false,
  }

  try {
    // Check member exists and get their details
    const [existingMember] = await db
      .select({
        id: member.id,
        userId: member.userId,
        role: member.role,
      })
      .from(member)
      .where(and(eq(member.id, memberId), eq(member.organizationId, organizationId)))
      .limit(1)

    if (!existingMember) {
      return { success: false, error: 'Member not found', billingActions }
    }

    // Prevent removing owner
    if (existingMember.role === 'owner') {
      return { success: false, error: 'Cannot remove organization owner', billingActions }
    }

    // STEP 1: Capture departed member's usage (add to org's departedMemberUsage)
    if (!skipBillingLogic) {
      try {
        const [departingUserStats] = await db
          .select({ currentPeriodCost: userStats.currentPeriodCost })
          .from(userStats)
          .where(eq(userStats.userId, userId))
          .limit(1)

        if (departingUserStats?.currentPeriodCost) {
          const usage = toNumber(toDecimal(departingUserStats.currentPeriodCost))
          if (usage > 0) {
            await db
              .update(organization)
              .set({
                departedMemberUsage: sql`${organization.departedMemberUsage} + ${usage}`,
              })
              .where(eq(organization.id, organizationId))

            await db
              .update(userStats)
              .set({ currentPeriodCost: '0' })
              .where(eq(userStats.userId, userId))

            billingActions.usageCaptured = usage

            logger.info('Captured departed member usage', {
              organizationId,
              userId,
              usage,
            })
          }
        }
      } catch (usageCaptureError) {
        logger.error('Failed to capture departed member usage', {
          organizationId,
          userId,
          error: usageCaptureError,
        })
      }
    }

    // STEP 2: Delete the member record
    await db.delete(member).where(eq(member.id, memberId))

    logger.info('Removed member from organization', {
      organizationId,
      userId,
      memberId,
    })

    // STEP 3: Restore personal Pro if user has no remaining paid team memberships
    if (!skipBillingLogic) {
      try {
        const remainingPaidTeams = await db
          .select({ orgId: member.organizationId })
          .from(member)
          .where(eq(member.userId, userId))

        let hasAnyPaidTeam = false
        if (remainingPaidTeams.length > 0) {
          const orgIds = remainingPaidTeams.map((m) => m.orgId)
          const orgPaidSubs = await db
            .select()
            .from(subscriptionTable)
            .where(
              and(
                inArray(subscriptionTable.referenceId, orgIds),
                inArray(subscriptionTable.status, ENTITLED_SUBSCRIPTION_STATUSES)
              )
            )

          // Still covered by a paid org sub → don't restore personal Pro.
          hasAnyPaidTeam = orgPaidSubs.some((s) => isPaid(s.plan))
        }

        if (!hasAnyPaidTeam) {
          const restoreResult = await restoreUserProSubscription(userId)
          billingActions.proRestored = restoreResult.restored
          billingActions.usageRestored = restoreResult.usageRestored

          await syncUsageLimitsFromSubscription(userId)
        }
      } catch (postRemoveError) {
        logger.error('Post-removal personal Pro restore check failed', {
          organizationId,
          userId,
          error: postRemoveError,
        })
      }
    }

    return { success: true, billingActions }
  } catch (error) {
    logger.error('Failed to remove user from organization', {
      userId,
      organizationId,
      memberId,
      error,
    })
    return { success: false, error: 'Failed to remove user from organization', billingActions }
  }
}

/**
 * Check if a user is a member of a specific organization.
 */
export async function isUserMemberOfOrganization(
  userId: string,
  organizationId: string
): Promise<{ isMember: boolean; role?: string; memberId?: string }> {
  const [memberRecord] = await db
    .select({ id: member.id, role: member.role })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.organizationId, organizationId)))
    .limit(1)

  if (memberRecord) {
    return { isMember: true, role: memberRecord.role, memberId: memberRecord.id }
  }

  return { isMember: false }
}

/**
 * Get user's current organization membership (if any).
 */
export async function getUserOrganization(
  userId: string
): Promise<{ organizationId: string; role: string; memberId: string } | null> {
  const [memberRecord] = await db
    .select({
      organizationId: member.organizationId,
      role: member.role,
      memberId: member.id,
    })
    .from(member)
    .where(eq(member.userId, userId))
    .limit(1)

  return memberRecord || null
}
