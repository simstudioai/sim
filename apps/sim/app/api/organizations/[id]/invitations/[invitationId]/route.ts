import { randomUUID } from 'crypto'
import { db } from '@sim/db'
import {
  invitation,
  member,
  organization,
  permissions,
  subscription as subscriptionTable,
  user,
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

    // After accepting an invitation to a paid team, auto-cancel personal Pro at period end
    if (status === 'accepted') {
      try {
        // Check if organization has an active paid subscription
        const orgSubs = await db
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
          const personalSubs = await db
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
          if (personalPro && personalPro.cancelAtPeriodEnd !== true) {
            const stripe = requireStripeClient()
            if (personalPro.stripeSubscriptionId) {
              try {
                await stripe.subscriptions.update(personalPro.stripeSubscriptionId, {
                  cancel_at_period_end: true,
                })
              } catch (stripeError) {
                logger.error('Failed to set cancel_at_period_end on Stripe for personal Pro', {
                  userId,
                  subscriptionId: personalPro.id,
                  stripeSubscriptionId: personalPro.stripeSubscriptionId,
                  error: stripeError,
                })
              }
            }

            try {
              await db
                .update(subscriptionTable)
                .set({ cancelAtPeriodEnd: true })
                .where(eq(subscriptionTable.id, personalPro.id))

              logger.info('Auto-cancelled personal Pro at period end after joining paid team', {
                userId,
                personalSubscriptionId: personalPro.id,
                organizationId,
              })
            } catch (dbError) {
              logger.error('Failed to update DB cancelAtPeriodEnd for personal Pro', {
                userId,
                subscriptionId: personalPro?.id,
                error: dbError,
              })
            }
          }
        }
      } catch (error) {
        logger.error('Post-accept auto-cancel personal Pro failed', {
          organizationId,
          userId: session.user.id,
          error,
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
