import { db } from '@sim/db'
import { member, user, userStats } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { getUserUsageData } from '@/lib/billing/core/usage'
import { requireStripeClient } from '@/lib/billing/stripe-client'
import { createLogger } from '@/lib/logs/console/logger'
import { removeUserFromOrganization } from '@/lib/organizations/membership'

const logger = createLogger('OrganizationMemberAPI')

const updateMemberSchema = z.object({
  role: z.enum(['owner', 'admin', 'member'], {
    errorMap: () => ({ message: 'Invalid role' }),
  }),
})

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
          usageLimitUpdatedAt: userStats.usageLimitUpdatedAt,
          lastPeriodCost: userStats.lastPeriodCost,
        })
        .from(userStats)
        .where(eq(userStats.userId, memberId))
        .limit(1)

      const computed = await getUserUsageData(memberId)

      if (usageData.length > 0) {
        memberData = {
          ...memberData,
          usage: {
            ...usageData[0],
            billingPeriodStart: computed.billingPeriodStart,
            billingPeriodEnd: computed.billingPeriodEnd,
          },
        } as typeof memberData & {
          usage: (typeof usageData)[0] & {
            billingPeriodStart: Date | null
            billingPeriodEnd: Date | null
          }
        }
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
    const body = await request.json()

    const validation = updateMemberSchema.safeParse(body)
    if (!validation.success) {
      const firstError = validation.error.errors[0]
      return NextResponse.json({ error: firstError.message }, { status: 400 })
    }

    const { role } = validation.data

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

    // Prevent admins from changing other admins' roles - only owners can modify admin roles
    if (targetMember[0].role === 'admin' && userMember[0].role !== 'owner') {
      return NextResponse.json({ error: 'Only owners can change admin roles' }, { status: 403 })
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

    const { id: organizationId, memberId: targetUserId } = await params

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
      ['owner', 'admin'].includes(userMember[0].role) || session.user.id === targetUserId

    if (!canRemoveMembers) {
      return NextResponse.json({ error: 'Forbidden - Insufficient permissions' }, { status: 403 })
    }

    // Check if target member exists and get member ID
    const targetMember = await db
      .select({ id: member.id, role: member.role })
      .from(member)
      .where(and(eq(member.organizationId, organizationId), eq(member.userId, targetUserId)))
      .limit(1)

    if (targetMember.length === 0) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    }

    // Use shared helper for member removal with full billing logic
    const result = await removeUserFromOrganization({
      userId: targetUserId,
      organizationId,
      memberId: targetMember[0].id,
    })

    if (!result.success) {
      // Handle specific error cases
      if (result.error === 'Cannot remove organization owner') {
        return NextResponse.json({ error: result.error }, { status: 400 })
      }
      if (result.error === 'Member not found') {
        return NextResponse.json({ error: result.error }, { status: 404 })
      }
      return NextResponse.json({ error: result.error }, { status: 500 })
    }

    // If Pro was restored and has a Stripe subscription, update Stripe
    if (result.billingActions.proRestored) {
      try {
        // Get the user's Pro subscription to update Stripe
        const { subscription: subscriptionTable } = await import('@sim/db/schema')
        const [personalPro] = await db
          .select({ stripeSubscriptionId: subscriptionTable.stripeSubscriptionId })
          .from(subscriptionTable)
          .where(
            and(
              eq(subscriptionTable.referenceId, targetUserId),
              eq(subscriptionTable.status, 'active'),
              eq(subscriptionTable.plan, 'pro')
            )
          )
          .limit(1)

        if (personalPro?.stripeSubscriptionId) {
          const stripe = requireStripeClient()
          await stripe.subscriptions.update(personalPro.stripeSubscriptionId, {
            cancel_at_period_end: false,
          })
          logger.info('Restored Stripe subscription cancel_at_period_end', {
            userId: targetUserId,
            stripeSubscriptionId: personalPro.stripeSubscriptionId,
          })
        }
      } catch (stripeError) {
        logger.error('Failed to restore Stripe subscription', {
          userId: targetUserId,
          error: stripeError,
        })
      }
    }

    logger.info('Organization member removed', {
      organizationId,
      removedMemberId: targetUserId,
      removedBy: session.user.id,
      wasSelfRemoval: session.user.id === targetUserId,
      billingActions: result.billingActions,
    })

    return NextResponse.json({
      success: true,
      message:
        session.user.id === targetUserId
          ? 'You have left the organization'
          : 'Member removed successfully',
      data: {
        removedMemberId: targetUserId,
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
