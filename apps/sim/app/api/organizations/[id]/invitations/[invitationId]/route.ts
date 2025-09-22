import { randomUUID } from 'crypto'
import { db } from '@sim/db'
import {
  invitation,
  member,
  organization,
  permissions,
  subscription as subscriptionTable,
  user,
  userStats,
  type WorkspaceInvitationStatus,
  workspaceInvitation,
} from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { requireStripeClient } from '@/lib/billing/stripe-client'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('OrganizationInvitation')

// Get invitation details
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; invitationId: string }> }
) {
  const { id: organizationId, invitationId } = await params
  const session = await getSession()

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const orgInvitation = await db
      .select()
      .from(invitation)
      .where(and(eq(invitation.id, invitationId), eq(invitation.organizationId, organizationId)))
      .then((rows) => rows[0])

    if (!orgInvitation) {
      return NextResponse.json({ error: 'Invitation not found' }, { status: 404 })
    }

    const org = await db
      .select()
      .from(organization)
      .where(eq(organization.id, organizationId))
      .then((rows) => rows[0])

    if (!org) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
    }

    return NextResponse.json({
      invitation: orgInvitation,
      organization: org,
    })
  } catch (error) {
    logger.error('Error fetching organization invitation:', error)
    return NextResponse.json({ error: 'Failed to fetch invitation' }, { status: 500 })
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; invitationId: string }> }
) {
  const { id: organizationId, invitationId } = await params

  logger.info(
    '[PUT /api/organizations/[id]/invitations/[invitationId]] Invitation acceptance request',
    {
      organizationId,
      invitationId,
      path: req.url,
    }
  )

  const session = await getSession()

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { status } = await req.json()

    if (!status || !['accepted', 'rejected', 'cancelled'].includes(status)) {
      return NextResponse.json(
        { error: 'Invalid status. Must be "accepted", "rejected", or "cancelled"' },
        { status: 400 }
      )
    }

    const orgInvitation = await db
      .select()
      .from(invitation)
      .where(and(eq(invitation.id, invitationId), eq(invitation.organizationId, organizationId)))
      .then((rows) => rows[0])

    if (!orgInvitation) {
      return NextResponse.json({ error: 'Invitation not found' }, { status: 404 })
    }

    if (orgInvitation.status !== 'pending') {
      return NextResponse.json({ error: 'Invitation already processed' }, { status: 400 })
    }

    if (status === 'accepted') {
      const userData = await db
        .select()
        .from(user)
        .where(eq(user.id, session.user.id))
        .then((rows) => rows[0])

      if (!userData || userData.email.toLowerCase() !== orgInvitation.email.toLowerCase()) {
        return NextResponse.json(
          { error: 'Email mismatch. You can only accept invitations sent to your email address.' },
          { status: 403 }
        )
      }
    }

    if (status === 'cancelled') {
      const isAdmin = await db
        .select()
        .from(member)
        .where(
          and(
            eq(member.organizationId, organizationId),
            eq(member.userId, session.user.id),
            eq(member.role, 'admin')
          )
        )
        .then((rows) => rows.length > 0)

      if (!isAdmin) {
        return NextResponse.json(
          { error: 'Only organization admins can cancel invitations' },
          { status: 403 }
        )
      }
    }

    // Enforce: user can only be part of a single organization
    if (status === 'accepted') {
      // Check if user is already a member of ANY organization
      const existingOrgMemberships = await db
        .select({ organizationId: member.organizationId })
        .from(member)
        .where(eq(member.userId, session.user.id))

      if (existingOrgMemberships.length > 0) {
        // Check if already a member of THIS specific organization
        const alreadyMemberOfThisOrg = existingOrgMemberships.some(
          (m) => m.organizationId === organizationId
        )

        if (alreadyMemberOfThisOrg) {
          return NextResponse.json(
            { error: 'You are already a member of this organization' },
            { status: 400 }
          )
        }

        // Member of a different organization
        // Mark the invitation as rejected since they can't accept it
        await db
          .update(invitation)
          .set({
            status: 'rejected',
          })
          .where(eq(invitation.id, invitationId))

        return NextResponse.json(
          {
            error:
              'You are already a member of an organization. Leave your current organization before accepting a new invitation.',
          },
          { status: 409 }
        )
      }
    }

    let personalProToCancel: any = null

    await db.transaction(async (tx) => {
      await tx.update(invitation).set({ status }).where(eq(invitation.id, invitationId))

      if (status === 'accepted') {
        await tx.insert(member).values({
          id: randomUUID(),
          userId: session.user.id,
          organizationId,
          role: orgInvitation.role,
          createdAt: new Date(),
        })

        // Snapshot Pro usage and cancel Pro subscription when joining a paid team
        try {
          const orgSubs = await tx
            .select()
            .from(subscriptionTable)
            .where(
              and(
                eq(subscriptionTable.referenceId, organizationId),
                eq(subscriptionTable.status, 'active')
              )
            )
            .limit(1)

          const orgSub = orgSubs[0]
          const orgIsPaid = orgSub && (orgSub.plan === 'team' || orgSub.plan === 'enterprise')

          if (orgIsPaid) {
            const userId = session.user.id

            // Find user's active personal Pro subscription
            const personalSubs = await tx
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

            const personalPro = personalSubs[0]
            if (personalPro) {
              // Snapshot the current Pro usage before resetting
              const userStatsRows = await tx
                .select({
                  currentPeriodCost: userStats.currentPeriodCost,
                })
                .from(userStats)
                .where(eq(userStats.userId, userId))
                .limit(1)

              if (userStatsRows.length > 0) {
                const currentProUsage = userStatsRows[0].currentPeriodCost || '0'

                // Snapshot Pro usage and reset currentPeriodCost so new usage goes to team
                await tx
                  .update(userStats)
                  .set({
                    proPeriodCostSnapshot: currentProUsage,
                    currentPeriodCost: '0', // Reset so new usage is attributed to team
                  })
                  .where(eq(userStats.userId, userId))

                logger.info('Snapshotted Pro usage when joining team', {
                  userId,
                  proUsageSnapshot: currentProUsage,
                  organizationId,
                })
              }

              // Mark for cancellation after transaction
              if (personalPro.cancelAtPeriodEnd !== true) {
                personalProToCancel = personalPro
              }
            }
          }
        } catch (error) {
          logger.error('Failed to handle Pro user joining team', {
            userId: session.user.id,
            organizationId,
            error,
          })
          // Don't fail the whole invitation acceptance due to this
        }

        const linkedWorkspaceInvitations = await tx
          .select()
          .from(workspaceInvitation)
          .where(
            and(
              eq(workspaceInvitation.orgInvitationId, invitationId),
              eq(workspaceInvitation.status, 'pending' as WorkspaceInvitationStatus)
            )
          )

        for (const wsInvitation of linkedWorkspaceInvitations) {
          await tx
            .update(workspaceInvitation)
            .set({
              status: 'accepted' as WorkspaceInvitationStatus,
              updatedAt: new Date(),
            })
            .where(eq(workspaceInvitation.id, wsInvitation.id))

          await tx.insert(permissions).values({
            id: randomUUID(),
            entityType: 'workspace',
            entityId: wsInvitation.workspaceId,
            userId: session.user.id,
            permissionType: wsInvitation.permissions || 'read',
            createdAt: new Date(),
            updatedAt: new Date(),
          })
        }
      } else if (status === 'cancelled') {
        await tx
          .update(workspaceInvitation)
          .set({ status: 'cancelled' as WorkspaceInvitationStatus })
          .where(eq(workspaceInvitation.orgInvitationId, invitationId))
      }
    })

    // Handle Pro subscription cancellation after transaction commits
    if (personalProToCancel) {
      try {
        const stripe = requireStripeClient()
        if (personalProToCancel.stripeSubscriptionId) {
          try {
            await stripe.subscriptions.update(personalProToCancel.stripeSubscriptionId, {
              cancel_at_period_end: true,
            })
          } catch (stripeError) {
            logger.error('Failed to set cancel_at_period_end on Stripe for personal Pro', {
              userId: session.user.id,
              subscriptionId: personalProToCancel.id,
              stripeSubscriptionId: personalProToCancel.stripeSubscriptionId,
              error: stripeError,
            })
          }
        }

        await db
          .update(subscriptionTable)
          .set({ cancelAtPeriodEnd: true })
          .where(eq(subscriptionTable.id, personalProToCancel.id))

        logger.info('Auto-cancelled personal Pro at period end after joining paid team', {
          userId: session.user.id,
          personalSubscriptionId: personalProToCancel.id,
          organizationId,
        })
      } catch (dbError) {
        logger.error('Failed to update DB cancelAtPeriodEnd for personal Pro', {
          userId: session.user.id,
          subscriptionId: personalProToCancel.id,
          error: dbError,
        })
      }
    }

    logger.info(`Organization invitation ${status}`, {
      organizationId,
      invitationId,
      userId: session.user.id,
      email: orgInvitation.email,
    })

    return NextResponse.json({
      success: true,
      message: `Invitation ${status} successfully`,
      invitation: { ...orgInvitation, status },
    })
  } catch (error) {
    logger.error(`Error updating organization invitation:`, error)
    return NextResponse.json({ error: 'Failed to update invitation' }, { status: 500 })
  }
}
