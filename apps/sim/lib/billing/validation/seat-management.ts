import { and, count, eq } from 'drizzle-orm'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import * as schema from '@/db/schema'
import { getHighestPrioritySubscription } from '../core/subscription'

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

/**
 * Validate if an organization can invite new members based on seat limits
 */
export async function validateSeatAvailability(
  organizationId: string,
  additionalSeats = 1
): Promise<SeatValidationResult> {
  try {
    // Get organization subscription
    const subscription = await getHighestPrioritySubscription(organizationId)

    if (!subscription) {
      return {
        canInvite: false,
        reason: 'No active subscription found',
        currentSeats: 0,
        maxSeats: 0,
        availableSeats: 0,
      }
    }

    // Free and Pro plans don't support organizations
    if (['free', 'pro'].includes(subscription.plan)) {
      return {
        canInvite: false,
        reason: 'Organization features require Team or Enterprise plan',
        currentSeats: 0,
        maxSeats: 0,
        availableSeats: 0,
      }
    }

    // Get current member count
    const memberCount = await db
      .select({ count: count() })
      .from(schema.member)
      .where(eq(schema.member.organizationId, organizationId))

    const currentSeats = memberCount[0]?.count || 0

    // Determine seat limits based on subscription
    let maxSeats = subscription.seats || 1

    // For enterprise plans, check metadata for custom seat allowances
    if (subscription.plan === 'enterprise' && subscription.metadata) {
      try {
        const metadata = JSON.parse(subscription.metadata)
        if (metadata.maxSeats) {
          maxSeats = metadata.maxSeats
        }
      } catch (error) {
        logger.warn('Failed to parse enterprise subscription metadata', {
          organizationId,
          metadata: subscription.metadata,
          error,
        })
      }
    }

    const availableSeats = Math.max(0, maxSeats - currentSeats)
    const canInvite = availableSeats >= additionalSeats

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
    // Get organization details
    const organization = await db
      .select({
        id: schema.organization.id,
        name: schema.organization.name,
      })
      .from(schema.organization)
      .where(eq(schema.organization.id, organizationId))
      .limit(1)

    if (organization.length === 0) {
      return null
    }

    // Get subscription
    const subscription = await getHighestPrioritySubscription(organizationId)

    if (!subscription) {
      return null
    }

    // Get current member count
    const memberCount = await db
      .select({ count: count() })
      .from(schema.member)
      .where(eq(schema.member.organizationId, organizationId))

    const currentSeats = memberCount[0]?.count || 0

    // Determine seat limits
    let maxSeats = subscription.seats || 1
    let canAddSeats = true

    if (subscription.plan === 'enterprise' && subscription.metadata) {
      try {
        const metadata = JSON.parse(subscription.metadata)
        if (metadata.maxSeats) {
          maxSeats = metadata.maxSeats
        }
        // Enterprise plans might have fixed seat counts
        canAddSeats = !metadata.fixedSeats
      } catch (error) {
        logger.warn('Failed to parse enterprise subscription metadata', { organizationId, error })
      }
    }

    const availableSeats = Math.max(0, maxSeats - currentSeats)

    return {
      organizationId,
      organizationName: organization[0].name,
      currentSeats,
      maxSeats,
      availableSeats,
      subscriptionPlan: subscription.plan,
      canAddSeats,
    }
  } catch (error) {
    logger.error('Failed to get organization seat info', { organizationId, error })
    return null
  }
}

/**
 * Validate and reserve seats for bulk invitations
 */
export async function validateBulkInvitations(
  organizationId: string,
  emailList: string[]
): Promise<{
  canInviteAll: boolean
  validEmails: string[]
  duplicateEmails: string[]
  existingMembers: string[]
  seatsNeeded: number
  seatsAvailable: number
  validationResult: SeatValidationResult
}> {
  try {
    // Remove duplicates and validate email format
    const uniqueEmails = [...new Set(emailList)]
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    const validEmails = uniqueEmails.filter((email) => emailRegex.test(email))
    const duplicateEmails = emailList.filter((email, index) => emailList.indexOf(email) !== index)

    // Check for existing members
    const existingMembers = await db
      .select({ userEmail: schema.user.email })
      .from(schema.member)
      .innerJoin(schema.user, eq(schema.member.userId, schema.user.id))
      .where(eq(schema.member.organizationId, organizationId))

    const existingEmails = existingMembers.map((m) => m.userEmail)
    const newEmails = validEmails.filter((email) => !existingEmails.includes(email))

    // Check for pending invitations
    const pendingInvitations = await db
      .select({ email: schema.invitation.email })
      .from(schema.invitation)
      .where(
        and(
          eq(schema.invitation.organizationId, organizationId),
          eq(schema.invitation.status, 'pending')
        )
      )

    const pendingEmails = pendingInvitations.map((i) => i.email)
    const finalEmailsToInvite = newEmails.filter((email) => !pendingEmails.includes(email))

    // Validate seat availability
    const seatsNeeded = finalEmailsToInvite.length
    const validationResult = await validateSeatAvailability(organizationId, seatsNeeded)

    return {
      canInviteAll: validationResult.canInvite && finalEmailsToInvite.length > 0,
      validEmails: finalEmailsToInvite,
      duplicateEmails,
      existingMembers: validEmails.filter((email) => existingEmails.includes(email)),
      seatsNeeded,
      seatsAvailable: validationResult.availableSeats,
      validationResult,
    }
  } catch (error) {
    logger.error('Failed to validate bulk invitations', {
      organizationId,
      emailCount: emailList.length,
      error,
    })

    const validationResult: SeatValidationResult = {
      canInvite: false,
      reason: 'Validation failed',
      currentSeats: 0,
      maxSeats: 0,
      availableSeats: 0,
    }

    return {
      canInviteAll: false,
      validEmails: [],
      duplicateEmails: [],
      existingMembers: [],
      seatsNeeded: 0,
      seatsAvailable: 0,
      validationResult,
    }
  }
}

/**
 * Update organization seat count in subscription
 */
export async function updateOrganizationSeats(
  organizationId: string,
  newSeatCount: number,
  updatedBy: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // Get current subscription
    const subscription = await getHighestPrioritySubscription(organizationId)

    if (!subscription) {
      return { success: false, error: 'No active subscription found' }
    }

    // Validate minimum seat requirements
    const memberCount = await db
      .select({ count: count() })
      .from(schema.member)
      .where(eq(schema.member.organizationId, organizationId))

    const currentMembers = memberCount[0]?.count || 0

    if (newSeatCount < currentMembers) {
      return {
        success: false,
        error: `Cannot reduce seats below current member count (${currentMembers})`,
      }
    }

    // Update subscription seat count
    await db
      .update(schema.subscription)
      .set({
        seats: newSeatCount,
      })
      .where(eq(schema.subscription.id, subscription.id))

    logger.info('Organization seat count updated', {
      organizationId,
      oldSeatCount: subscription.seats,
      newSeatCount,
      updatedBy,
    })

    return { success: true }
  } catch (error) {
    logger.error('Failed to update organization seats', {
      organizationId,
      newSeatCount,
      updatedBy,
      error,
    })

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Check if a user can be removed from an organization
 */
export async function validateMemberRemoval(
  organizationId: string,
  userIdToRemove: string,
  removedBy: string
): Promise<{ canRemove: boolean; reason?: string }> {
  try {
    // Get member details
    const member = await db
      .select({ role: schema.member.role })
      .from(schema.member)
      .where(
        and(
          eq(schema.member.organizationId, organizationId),
          eq(schema.member.userId, userIdToRemove)
        )
      )
      .limit(1)

    if (member.length === 0) {
      return { canRemove: false, reason: 'Member not found in organization' }
    }

    // Check if trying to remove the organization owner
    if (member[0].role === 'owner') {
      return { canRemove: false, reason: 'Cannot remove organization owner' }
    }

    // Check if the person removing has sufficient permissions
    const removerMember = await db
      .select({ role: schema.member.role })
      .from(schema.member)
      .where(
        and(eq(schema.member.organizationId, organizationId), eq(schema.member.userId, removedBy))
      )
      .limit(1)

    if (removerMember.length === 0) {
      return { canRemove: false, reason: 'You are not a member of this organization' }
    }

    const removerRole = removerMember[0].role
    const targetRole = member[0].role

    // Permission hierarchy: owner > admin > member
    if (removerRole === 'owner') {
      // Owners can remove anyone except themselves
      return userIdToRemove === removedBy
        ? { canRemove: false, reason: 'Cannot remove yourself as owner' }
        : { canRemove: true }
    }

    if (removerRole === 'admin') {
      // Admins can remove members but not other admins or owners
      return targetRole === 'member'
        ? { canRemove: true }
        : { canRemove: false, reason: 'Insufficient permissions to remove this member' }
    }

    // Members cannot remove other members
    return { canRemove: false, reason: 'Insufficient permissions' }
  } catch (error) {
    logger.error('Failed to validate member removal', {
      organizationId,
      userIdToRemove,
      removedBy,
      error,
    })

    return { canRemove: false, reason: 'Validation failed' }
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

    // Get member activity data
    const memberActivity = await db
      .select({
        userId: schema.member.userId,
        userName: schema.user.name,
        userEmail: schema.user.email,
        role: schema.member.role,
        joinedAt: schema.member.createdAt,
        lastActive: schema.userStats.lastActive,
      })
      .from(schema.member)
      .innerJoin(schema.user, eq(schema.member.userId, schema.user.id))
      .leftJoin(schema.userStats, eq(schema.member.userId, schema.userStats.userId))
      .where(eq(schema.member.organizationId, organizationId))

    // Calculate utilization metrics
    const utilizationRate =
      seatInfo.maxSeats > 0 ? (seatInfo.currentSeats / seatInfo.maxSeats) * 100 : 0

    const recentlyActive = memberActivity.filter((member) => {
      if (!member.lastActive) return false
      const daysSinceActive = (Date.now() - member.lastActive.getTime()) / (1000 * 60 * 60 * 24)
      return daysSinceActive <= 30 // Active in last 30 days
    }).length

    return {
      ...seatInfo,
      utilizationRate: Math.round(utilizationRate * 100) / 100,
      activeMembers: recentlyActive,
      inactiveMembers: seatInfo.currentSeats - recentlyActive,
      memberActivity,
    }
  } catch (error) {
    logger.error('Failed to get organization seat analytics', { organizationId, error })
    return null
  }
}
