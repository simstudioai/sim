import { db } from '@sim/db'
import { member, userStats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getSimplifiedBillingSummary } from '@/lib/billing/core/billing'
import { getOrganizationBillingData } from '@/lib/billing/core/organization'

/**
 * Gets the effective billing blocked status for a user.
 * If user is in an org, also checks if the org owner is blocked.
 */
async function getEffectiveBillingStatus(userId: string): Promise<{
  billingBlocked: boolean
  billingBlockedReason: 'payment_failed' | 'dispute' | null
  blockedByOrgOwner: boolean
}> {
  // Check user's own status
  const userStatsRows = await db
    .select({
      blocked: userStats.billingBlocked,
      blockedReason: userStats.billingBlockedReason,
    })
    .from(userStats)
    .where(eq(userStats.userId, userId))
    .limit(1)

  const userBlocked = userStatsRows.length > 0 ? !!userStatsRows[0].blocked : false
  const userBlockedReason = userStatsRows.length > 0 ? userStatsRows[0].blockedReason : null

  if (userBlocked) {
    return {
      billingBlocked: true,
      billingBlockedReason: userBlockedReason,
      blockedByOrgOwner: false,
    }
  }

  // Check if user is in an org where owner is blocked
  const memberships = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(eq(member.userId, userId))

  for (const m of memberships) {
    const owners = await db
      .select({ userId: member.userId })
      .from(member)
      .where(and(eq(member.organizationId, m.organizationId), eq(member.role, 'owner')))
      .limit(1)

    if (owners.length > 0 && owners[0].userId !== userId) {
      const ownerStats = await db
        .select({
          blocked: userStats.billingBlocked,
          blockedReason: userStats.billingBlockedReason,
        })
        .from(userStats)
        .where(eq(userStats.userId, owners[0].userId))
        .limit(1)

      if (ownerStats.length > 0 && ownerStats[0].blocked) {
        return {
          billingBlocked: true,
          billingBlockedReason: ownerStats[0].blockedReason,
          blockedByOrgOwner: true,
        }
      }
    }
  }

  return {
    billingBlocked: false,
    billingBlockedReason: null,
    blockedByOrgOwner: false,
  }
}

const logger = createLogger('UnifiedBillingAPI')

/**
 * Unified Billing Endpoint
 */
export async function GET(request: NextRequest) {
  const session = await getSession()

  try {
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const context = searchParams.get('context') || 'user'
    const contextId = searchParams.get('id')
    const includeOrg = searchParams.get('includeOrg') === 'true'

    // Validate context parameter
    if (!['user', 'organization'].includes(context)) {
      return NextResponse.json(
        { error: 'Invalid context. Must be "user" or "organization"' },
        { status: 400 }
      )
    }

    // For organization context, require contextId
    if (context === 'organization' && !contextId) {
      return NextResponse.json(
        { error: 'Organization ID is required when context=organization' },
        { status: 400 }
      )
    }

    let billingData

    if (context === 'user') {
      // Get user billing (may include organization if they're part of one)
      billingData = await getSimplifiedBillingSummary(session.user.id, contextId || undefined)

      // Attach effective billing blocked status (includes org owner check)
      const billingStatus = await getEffectiveBillingStatus(session.user.id)

      billingData = {
        ...billingData,
        billingBlocked: billingStatus.billingBlocked,
        billingBlockedReason: billingStatus.billingBlockedReason,
        blockedByOrgOwner: billingStatus.blockedByOrgOwner,
      }

      // Optionally include organization membership and role
      if (includeOrg) {
        const userMembership = await db
          .select({
            organizationId: member.organizationId,
            role: member.role,
          })
          .from(member)
          .where(eq(member.userId, session.user.id))
          .limit(1)

        if (userMembership.length > 0) {
          billingData = {
            ...billingData,
            organization: {
              id: userMembership[0].organizationId,
              role: userMembership[0].role as 'owner' | 'admin' | 'member',
            },
          }
        }
      }
    } else {
      // Get user role in organization for permission checks first
      const memberRecord = await db
        .select({ role: member.role })
        .from(member)
        .where(and(eq(member.organizationId, contextId!), eq(member.userId, session.user.id)))
        .limit(1)

      if (memberRecord.length === 0) {
        return NextResponse.json(
          { error: 'Access denied - not a member of this organization' },
          { status: 403 }
        )
      }

      // Get organization-specific billing
      const rawBillingData = await getOrganizationBillingData(contextId!)

      if (!rawBillingData) {
        return NextResponse.json(
          { error: 'Organization not found or access denied' },
          { status: 404 }
        )
      }

      // Transform data to match component expectations
      billingData = {
        organizationId: rawBillingData.organizationId,
        organizationName: rawBillingData.organizationName,
        subscriptionPlan: rawBillingData.subscriptionPlan,
        subscriptionStatus: rawBillingData.subscriptionStatus,
        totalSeats: rawBillingData.totalSeats,
        usedSeats: rawBillingData.usedSeats,
        seatsCount: rawBillingData.seatsCount,
        totalCurrentUsage: rawBillingData.totalCurrentUsage,
        totalUsageLimit: rawBillingData.totalUsageLimit,
        minimumBillingAmount: rawBillingData.minimumBillingAmount,
        averageUsagePerMember: rawBillingData.averageUsagePerMember,
        billingPeriodStart: rawBillingData.billingPeriodStart?.toISOString() || null,
        billingPeriodEnd: rawBillingData.billingPeriodEnd?.toISOString() || null,
        members: rawBillingData.members.map((member) => ({
          ...member,
          joinedAt: member.joinedAt.toISOString(),
          lastActive: member.lastActive?.toISOString() || null,
        })),
      }

      const userRole = memberRecord[0].role

      // Get effective billing blocked status (includes org owner check)
      const billingStatus = await getEffectiveBillingStatus(session.user.id)

      // Merge blocked flag into data for convenience
      billingData = {
        ...billingData,
        billingBlocked: billingStatus.billingBlocked,
        billingBlockedReason: billingStatus.billingBlockedReason,
        blockedByOrgOwner: billingStatus.blockedByOrgOwner,
      }

      return NextResponse.json({
        success: true,
        context,
        data: billingData,
        userRole,
        billingBlocked: billingData.billingBlocked,
        billingBlockedReason: billingData.billingBlockedReason,
        blockedByOrgOwner: billingData.blockedByOrgOwner,
      })
    }

    return NextResponse.json({
      success: true,
      context,
      data: billingData,
    })
  } catch (error) {
    logger.error('Failed to get billing data', {
      userId: session?.user?.id,
      error,
    })

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
