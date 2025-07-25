import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import { member, user, userStats } from '@/db/schema'

const logger = createLogger('OrganizationMemberAPI')

export const dynamic = 'force-dynamic'

/**
 * GET /api/organizations/[id]/members/[memberId]
 * Get individual organization member details
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
    const url = new URL(request.url)
    const includeUsage = url.searchParams.get('include') === 'usage'

    // Verify user has access to this organization
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

    // Get target member details
    const memberQuery = db
      .select({
        id: member.id,
        userId: member.userId,
        organizationId: member.organizationId,
        role: member.role,
        createdAt: member.createdAt,
        userName: user.name,
        userEmail: user.email,
      })
      .from(member)
      .innerJoin(user, eq(member.userId, user.id))
      .where(and(eq(member.organizationId, organizationId), eq(member.userId, memberId)))
      .limit(1)

    const memberEntry = await memberQuery

    if (memberEntry.length === 0) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    }

    // Check if user can view this member's details
    const canViewDetails = hasAdminAccess || session.user.id === memberId

    if (!canViewDetails) {
      return NextResponse.json({ error: 'Forbidden - Insufficient permissions' }, { status: 403 })
    }

    let memberData = memberEntry[0]

    // Include usage data if requested and user has permission
    if (includeUsage && hasAdminAccess) {
      const usageData = await db
        .select({
          currentPeriodCost: userStats.currentPeriodCost,
          currentUsageLimit: userStats.currentUsageLimit,
          billingPeriodStart: userStats.billingPeriodStart,
          billingPeriodEnd: userStats.billingPeriodEnd,
          usageLimitSetBy: userStats.usageLimitSetBy,
          usageLimitUpdatedAt: userStats.usageLimitUpdatedAt,
          lastPeriodCost: userStats.lastPeriodCost,
        })
        .from(userStats)
        .where(eq(userStats.userId, memberId))
        .limit(1)

      if (usageData.length > 0) {
        memberData = {
          ...memberData,
          usage: usageData[0],
        } as typeof memberData & { usage: (typeof usageData)[0] }
      }
    }

    return NextResponse.json({
      success: true,
      data: memberData,
      userRole,
      hasAdminAccess,
    })
  } catch (error) {
    logger.error('Failed to get organization member', {
      organizationId: (await params).id,
      memberId: (await params).memberId,
      error,
    })

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * PUT /api/organizations/[id]/members/[memberId]
 * Update organization member role
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
    const { role } = await request.json()

    // Validate input
    if (!role || !['admin', 'member'].includes(role)) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
    }

    // Verify user has admin access
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

    if (!['owner', 'admin'].includes(userMember[0].role)) {
      return NextResponse.json({ error: 'Forbidden - Admin access required' }, { status: 403 })
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

    // Prevent changing owner role
    if (targetMember[0].role === 'owner') {
      return NextResponse.json({ error: 'Cannot change owner role' }, { status: 400 })
    }

    // Prevent non-owners from promoting to admin
    if (role === 'admin' && userMember[0].role !== 'owner') {
      return NextResponse.json(
        { error: 'Only owners can promote members to admin' },
        { status: 403 }
      )
    }

    // Update member role
    const updatedMember = await db
      .update(member)
      .set({ role })
      .where(and(eq(member.organizationId, organizationId), eq(member.userId, memberId)))
      .returning()

    if (updatedMember.length === 0) {
      return NextResponse.json({ error: 'Failed to update member role' }, { status: 500 })
    }

    logger.info('Organization member role updated', {
      organizationId,
      memberId,
      newRole: role,
      updatedBy: session.user.id,
    })

    return NextResponse.json({
      success: true,
      message: 'Member role updated successfully',
      data: {
        id: updatedMember[0].id,
        userId: updatedMember[0].userId,
        role: updatedMember[0].role,
        updatedBy: session.user.id,
      },
    })
  } catch (error) {
    logger.error('Failed to update organization member role', {
      organizationId: (await params).id,
      memberId: (await params).memberId,
      error,
    })

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/organizations/[id]/members/[memberId]
 * Remove member from organization
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; memberId: string }> }
) {
  try {
    const session = await getSession()

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: organizationId, memberId } = await params

    // Verify user has admin access
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

    const canRemoveMembers =
      ['owner', 'admin'].includes(userMember[0].role) || session.user.id === memberId

    if (!canRemoveMembers) {
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

    // Prevent removing the owner
    if (targetMember[0].role === 'owner') {
      return NextResponse.json({ error: 'Cannot remove organization owner' }, { status: 400 })
    }

    // Remove member
    const removedMember = await db
      .delete(member)
      .where(and(eq(member.organizationId, organizationId), eq(member.userId, memberId)))
      .returning()

    if (removedMember.length === 0) {
      return NextResponse.json({ error: 'Failed to remove member' }, { status: 500 })
    }

    logger.info('Organization member removed', {
      organizationId,
      removedMemberId: memberId,
      removedBy: session.user.id,
      wasSelfRemoval: session.user.id === memberId,
    })

    return NextResponse.json({
      success: true,
      message:
        session.user.id === memberId
          ? 'You have left the organization'
          : 'Member removed successfully',
      data: {
        removedMemberId: memberId,
        removedBy: session.user.id,
        removedAt: new Date().toISOString(),
      },
    })
  } catch (error) {
    logger.error('Failed to remove organization member', {
      organizationId: (await params).id,
      memberId: (await params).memberId,
      error,
    })

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
