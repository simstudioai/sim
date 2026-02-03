/**
 * Organization Membership Management
 *
 * Shared helpers for adding and removing users from organizations.
 * Used by both regular routes and admin routes to ensure consistent business logic.
 */

import { randomUUID } from 'crypto'
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
import { requireStripeClient } from '@/lib/billing/stripe-client'
import { validateSeatAvailability } from '@/lib/billing/validation/seat-management'

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
 * Restore a user's personal Pro subscription if it was paused (cancelAtPeriodEnd=true).
 * Also restores any snapshotted Pro usage from when they joined a team.
 *
 * Called when:
 * - A member leaves a team (via removeUserFromOrganization)
 * - A team subscription ends (members stay but get Pro restored)
 */
export async function restoreUserProSubscription(userId: string): Promise<RestoreProResult> {
  const result: RestoreProResult = {
    restored: false,
    usageRestored: false,
  }

  try {
    const [personalPro] = await db
      .select()
      .from(subscriptionTable)
      .where(
        and(
          eq(subscriptionTable.referenceId, userId),
          eq(subscriptionTable.status, 'active'),
          eq(subscriptionTable.plan, 'pro')
        )
      )
      .limit(1)

    if (!personalPro?.cancelAtPeriodEnd || !personalPro.stripeSubscriptionId) {
      return result
    }

    result.subscriptionId = personalPro.id

    try {
      const stripe = requireStripeClient()
      await stripe.subscriptions.update(personalPro.stripeSubscriptionId, {
        cancel_at_period_end: false,
      })
    } catch (stripeError) {
      logger.error('Stripe restore cancel_at_period_end failed for personal Pro', {
        userId,
        stripeSubscriptionId: personalPro.stripeSubscriptionId,
        error: stripeError,
      })
    }

    try {
      await db
        .update(subscriptionTable)
        .set({ cancelAtPeriodEnd: false })
        .where(eq(subscriptionTable.id, personalPro.id))

      result.restored = true

      logger.info('Restored personal Pro subscription', {
        userId,
        subscriptionId: personalPro.id,
      })
    } catch (dbError) {
      logger.error('DB update failed when restoring personal Pro', {
        userId,
        subscriptionId: personalPro.id,
        error: dbError,
      })
    }

    try {
      const [stats] = await db
        .select({
          currentPeriodCost: userStats.currentPeriodCost,
          proPeriodCostSnapshot: userStats.proPeriodCostSnapshot,
        })
        .from(userStats)
        .where(eq(userStats.userId, userId))
        .limit(1)

      if (stats) {
        const currentUsage = stats.currentPeriodCost || '0'
        const snapshotUsage = stats.proPeriodCostSnapshot || '0'
        const snapshotNum = Number.parseFloat(snapshotUsage)

        if (snapshotNum > 0) {
          const currentNum = Number.parseFloat(currentUsage)
          const restoredUsage = (currentNum + snapshotNum).toString()

          await db
            .update(userStats)
            .set({
              currentPeriodCost: restoredUsage,
              proPeriodCostSnapshot: '0',
            })
            .where(eq(userStats.userId, userId))

          result.usageRestored = true

          logger.info('Restored Pro usage snapshot', {
            userId,
            previousUsage: currentUsage,
            snapshotUsage,
            restoredUsage,
          })
        }
      }
    } catch (usageRestoreError) {
      logger.error('Failed to restore Pro usage snapshot', {
        userId,
        error: usageRestoreError,
      })
    }
  } catch (error) {
    logger.error('Failed to restore user Pro subscription', {
      userId,
      error,
    })
  }

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
}

export interface AddMemberResult {
  success: boolean
  memberId?: string
  error?: string
  billingActions: {
    proUsageSnapshotted: boolean
    proCancelledAtPeriodEnd: boolean
    /** If Pro was cancelled, contains info for Stripe update (caller can optionally call Stripe) */
    proSubscriptionToCancel?: {
      subscriptionId: string
      stripeSubscriptionId: string | null
    }
  }
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

/**
 * Validate if a user can be added to an organization.
 * Checks single-org constraint and seat availability.
 */
export async function validateMembershipAddition(
  userId: string,
  organizationId: string
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

  const seatValidation = await validateSeatAvailability(organizationId, 1)
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
  } = params

  const billingActions: AddMemberResult['billingActions'] = {
    proUsageSnapshotted: false,
    proCancelledAtPeriodEnd: false,
  }

  try {
    if (!skipSeatValidation) {
      const validation = await validateMembershipAddition(userId, organizationId)
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

    const [orgSub] = await db
      .select()
      .from(subscriptionTable)
      .where(
        and(
          eq(subscriptionTable.referenceId, organizationId),
          eq(subscriptionTable.status, 'active')
        )
      )
      .limit(1)

    const orgIsPaid = orgSub && (orgSub.plan === 'team' || orgSub.plan === 'enterprise')

    let memberId = ''

    await db.transaction(async (tx) => {
      memberId = randomUUID()
      await tx.insert(member).values({
        id: memberId,
        userId,
        organizationId,
        role,
        createdAt: new Date(),
      })

      // Handle Pro subscription if org is paid and we're not skipping billing logic
      if (orgIsPaid && !skipBillingLogic) {
        // Find user's active personal Pro subscription
        const [personalPro] = await tx
          .select()
          .from(subscriptionTable)
          .where(
            and(
              eq(subscriptionTable.referenceId, userId),
              eq(subscriptionTable.status, 'active'),
              eq(subscriptionTable.plan, 'pro')
            )
          )
          .limit(1)

        if (personalPro) {
          // Snapshot the current Pro usage before resetting
          const [userStatsRow] = await tx
            .select({ currentPeriodCost: userStats.currentPeriodCost })
            .from(userStats)
            .where(eq(userStats.userId, userId))
            .limit(1)

          if (userStatsRow) {
            const currentProUsage = userStatsRow.currentPeriodCost || '0'

            // Snapshot Pro usage and reset currentPeriodCost so new usage goes to team
            await tx
              .update(userStats)
              .set({
                proPeriodCostSnapshot: currentProUsage,
                currentPeriodCost: '0',
                currentPeriodCopilotCost: '0',
              })
              .where(eq(userStats.userId, userId))

            billingActions.proUsageSnapshotted = true

            logger.info('Snapshotted Pro usage when adding to team', {
              userId,
              proUsageSnapshot: currentProUsage,
              organizationId,
            })
          }

          // Mark Pro for cancellation at period end
          if (!personalPro.cancelAtPeriodEnd) {
            await tx
              .update(subscriptionTable)
              .set({ cancelAtPeriodEnd: true })
              .where(eq(subscriptionTable.id, personalPro.id))

            billingActions.proCancelledAtPeriodEnd = true
            billingActions.proSubscriptionToCancel = {
              subscriptionId: personalPro.id,
              stripeSubscriptionId: personalPro.stripeSubscriptionId,
            }

            logger.info('Marked personal Pro for cancellation at period end', {
              userId,
              subscriptionId: personalPro.id,
              organizationId,
            })
          }
        }
      }
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
          const usage = Number.parseFloat(departingUserStats.currentPeriodCost)
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
            .where(eq(subscriptionTable.status, 'active'))

          hasAnyPaidTeam = orgPaidSubs.some(
            (s) => orgIds.includes(s.referenceId) && ['team', 'enterprise'].includes(s.plan ?? '')
          )
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
