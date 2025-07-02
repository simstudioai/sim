import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { updateMemberUsageLimit } from '@/lib/billing/core/organization-billing'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import { member, userStats } from '@/db/schema'

const logger = createLogger('MemberUsageLimitAPI')

/**
 * GET /api/organizations/[id]/members/[memberId]/usage-limit
 * Get member's usage limit information
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; memberId: string }> }
) {
  try {
    const session = await getSession()

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: organizationId, memberId } = await params

    // Verify user has admin access or is the target member
    const userMember = await db
      .select()
      .from(member)
      .where(and(eq(member.organizationId, organizationId), eq(member.userId, session.user.id)))
      .limit(1)

    if (userMember.length === 0) {
      return NextResponse.json(
        { error: 'Forbidden - Not a member of this organization' },
        { status: 403 }
      )
    }

    const userRole = userMember[0].role
    const hasAdminAccess = ['owner', 'admin'].includes(userRole)
    const isSelfRequest = session.user.id === memberId

    if (!hasAdminAccess && !isSelfRequest) {
      return NextResponse.json({ error: 'Forbidden - Insufficient permissions' }, { status: 403 })
    }

    // Check if target member exists
    const targetMember = await db
      .select()
      .from(member)
      .where(and(eq(member.organizationId, organizationId), eq(member.userId, memberId)))
      .limit(1)

    if (targetMember.length === 0) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    }

    // Get member's usage limit information
    const usageData = await db
      .select({
        currentUsageLimit: userStats.currentUsageLimit,
        currentPeriodCost: userStats.currentPeriodCost,
        billingPeriodStart: userStats.billingPeriodStart,
        billingPeriodEnd: userStats.billingPeriodEnd,
        usageLimitSetBy: userStats.usageLimitSetBy,
        usageLimitUpdatedAt: userStats.usageLimitUpdatedAt,
        lastPeriodCost: userStats.lastPeriodCost,
      })
      .from(userStats)
      .where(eq(userStats.userId, memberId))
      .limit(1)

    if (usageData.length === 0) {
      return NextResponse.json({ error: 'Usage data not found for member' }, { status: 404 })
    }

    const usage = usageData[0]
    const usagePercentage =
      (Number(usage.currentPeriodCost) / Number(usage.currentUsageLimit)) * 100

    return NextResponse.json({
      success: true,
      data: {
        memberId,
        currentUsageLimit: Number(usage.currentUsageLimit),
        currentPeriodCost: Number(usage.currentPeriodCost),
        usagePercentage: Math.round(usagePercentage * 100) / 100,
        billingPeriodStart: usage.billingPeriodStart,
        billingPeriodEnd: usage.billingPeriodEnd,
        usageLimitSetBy: usage.usageLimitSetBy,
        usageLimitUpdatedAt: usage.usageLimitUpdatedAt,
        lastPeriodCost: usage.lastPeriodCost ? Number(usage.lastPeriodCost) : null,
        isExceeded: Number(usage.currentPeriodCost) > Number(usage.currentUsageLimit),
        isNearLimit: usagePercentage >= 80,
        canEditLimit: hasAdminAccess,
      },
      userRole,
      hasAdminAccess,
    })
  } catch (error) {
    logger.error('Failed to get member usage limit', {
      organizationId: (await params).id,
      memberId: (await params).memberId,
      error,
    })

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * PUT /api/organizations/[id]/members/[memberId]/usage-limit
 * Update usage limit for an organization member
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; memberId: string }> }
) {
  try {
    const session = await getSession()

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: organizationId, memberId } = await params
    const { limit } = await request.json()

    // Validate input
    if (typeof limit !== 'number' || limit < 0) {
      return NextResponse.json({ error: 'Invalid limit value' }, { status: 400 })
    }

    // Verify admin has permission
    const adminMember = await db
      .select()
      .from(member)
      .where(and(eq(member.organizationId, organizationId), eq(member.userId, session.user.id)))
      .limit(1)

    if (adminMember.length === 0) {
      return NextResponse.json(
        { error: 'Forbidden - Not a member of this organization' },
        { status: 403 }
      )
    }

    if (!['owner', 'admin'].includes(adminMember[0].role)) {
      return NextResponse.json({ error: 'Forbidden - Admin access required' }, { status: 403 })
    }

    // Check if target member exists
    const targetMember = await db
      .select()
      .from(member)
      .where(and(eq(member.organizationId, organizationId), eq(member.userId, memberId)))
      .limit(1)

    if (targetMember.length === 0) {
      return NextResponse.json({ error: 'Member not found in organization' }, { status: 404 })
    }

    // Update the member's usage limit
    await updateMemberUsageLimit(organizationId, memberId, limit, session.user.id)

    logger.info('Member usage limit updated', {
      organizationId,
      memberId,
      newLimit: limit,
      adminUserId: session.user.id,
    })

    return NextResponse.json({
      success: true,
      message: 'Usage limit updated successfully',
      data: {
        memberId,
        newLimit: limit,
        updatedBy: session.user.id,
        updatedAt: new Date().toISOString(),
      },
    })
  } catch (error) {
    logger.error('Failed to update member usage limit', {
      organizationId: (await params).id,
      memberId: (await params).memberId,
      error,
    })

    const errorMessage = error instanceof Error ? error.message : 'Internal server error'
    const statusCode =
      errorMessage.includes('permissions') || errorMessage.includes('not found') ? 400 : 500

    return NextResponse.json({ error: errorMessage }, { status: statusCode })
  }
}
