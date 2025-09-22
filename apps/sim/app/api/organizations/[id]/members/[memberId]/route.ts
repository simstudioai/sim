import { db } from '@sim/db'
import { member, subscription as subscriptionTable, user, userStats } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getUserUsageData } from '@/lib/billing/core/usage'
import { requireStripeClient } from '@/lib/billing/stripe-client'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('OrganizationMemberAPI')

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

    // If the removed user left their last paid team and has a personal Pro set to cancel_at_period_end, restore it
    try {
      const remainingPaidTeams = await db
        .select({ orgId: member.organizationId })
        .from(member)
        .where(eq(member.userId, memberId))

      let hasAnyPaidTeam = false
      if (remainingPaidTeams.length > 0) {
        const orgIds = remainingPaidTeams.map((m) => m.orgId)
        const orgPaidSubs = await db
          .select()
          .from(subscriptionTable)
          .where(and(eq(subscriptionTable.status, 'active'), eq(subscriptionTable.plan, 'team')))

        hasAnyPaidTeam = orgPaidSubs.some((s) => orgIds.includes(s.referenceId))
      }

      if (!hasAnyPaidTeam) {
        const personalProRows = await db
          .select()
          .from(subscriptionTable)
          .where(
            and(
              eq(subscriptionTable.referenceId, memberId),
              eq(subscriptionTable.status, 'active'),
              eq(subscriptionTable.plan, 'pro')
            )
          )
          .limit(1)

        const personalPro = personalProRows[0]
        if (
          personalPro &&
          personalPro.cancelAtPeriodEnd === true &&
          personalPro.stripeSubscriptionId
        ) {
          try {
            const stripe = requireStripeClient()
            await stripe.subscriptions.update(personalPro.stripeSubscriptionId, {
              cancel_at_period_end: false,
            })
          } catch (stripeError) {
            logger.error('Stripe restore cancel_at_period_end failed for personal Pro', {
              userId: memberId,
              stripeSubscriptionId: personalPro.stripeSubscriptionId,
              error: stripeError,
            })
          }

          try {
            await db
              .update(subscriptionTable)
              .set({ cancelAtPeriodEnd: false })
              .where(eq(subscriptionTable.id, personalPro.id))

            logger.info('Restored personal Pro after leaving last paid team', {
              userId: memberId,
              personalSubscriptionId: personalPro.id,
            })
          } catch (dbError) {
            logger.error('DB update failed when restoring personal Pro', {
              userId: memberId,
              subscriptionId: personalPro.id,
              error: dbError,
            })
          }

          // Also restore the snapshotted Pro usage back to currentPeriodCost
          try {
            const userStatsRows = await db
              .select({
                currentPeriodCost: userStats.currentPeriodCost,
                proPeriodCostSnapshot: userStats.proPeriodCostSnapshot,
              })
              .from(userStats)
              .where(eq(userStats.userId, memberId))
              .limit(1)

            if (userStatsRows.length > 0) {
              const currentUsage = userStatsRows[0].currentPeriodCost || '0'
              const snapshotUsage = userStatsRows[0].proPeriodCostSnapshot || '0'

              const currentNum = Number.parseFloat(currentUsage)
              const snapshotNum = Number.parseFloat(snapshotUsage)
              const restoredUsage = (currentNum + snapshotNum).toString()

              await db
                .update(userStats)
                .set({
                  currentPeriodCost: restoredUsage,
                  proPeriodCostSnapshot: '0', // Clear the snapshot
                })
                .where(eq(userStats.userId, memberId))

              logger.info('Restored Pro usage after leaving team', {
                userId: memberId,
                previousUsage: currentUsage,
                snapshotUsage: snapshotUsage,
                restoredUsage: restoredUsage,
              })
            }
          } catch (usageRestoreError) {
            logger.error('Failed to restore Pro usage after leaving team', {
              userId: memberId,
              error: usageRestoreError,
            })
          }
        }
      }
    } catch (postRemoveError) {
      logger.error('Post-removal personal Pro restore check failed', {
        organizationId,
        memberId,
        error: postRemoveError,
      })
    }

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
