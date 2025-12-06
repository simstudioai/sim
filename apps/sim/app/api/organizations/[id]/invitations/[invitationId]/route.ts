import { randomUUID } from 'crypto'
import { db } from '@sim/db'
import {
  invitation,
  member,
  organization,
  permissions,
  user,
  type WorkspaceInvitationStatus,
  workspaceInvitation,
} from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { requireStripeClient } from '@/lib/billing/stripe-client'
import { createLogger } from '@/lib/logs/console/logger'
import { addUserToOrganization, getUserOrganization } from '@/lib/organizations/membership'

const logger = createLogger('OrganizationInvitation')

const updateInvitationSchema = z.object({
  status: z.enum(['accepted', 'rejected', 'cancelled'], {
    errorMap: () => ({ message: 'Invalid status. Must be "accepted", "rejected", or "cancelled"' }),
  }),
})

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
    const body = await req.json()

    const validation = updateInvitationSchema.safeParse(body)
    if (!validation.success) {
      const firstError = validation.error.errors[0]
      return NextResponse.json({ error: firstError.message }, { status: 400 })
    }

    const { status } = validation.data

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
      const existingOrg = await getUserOrganization(session.user.id)

      if (existingOrg) {
        if (existingOrg.organizationId === organizationId) {
          return NextResponse.json(
            { error: 'You are already a member of this organization' },
            { status: 400 }
          )
        }

        // Member of a different organization - reject the invitation
        await db
          .update(invitation)
          .set({ status: 'rejected' })
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

    let membershipResult: Awaited<ReturnType<typeof addUserToOrganization>> | null = null

    if (status === 'accepted') {
      // Use shared helper for member creation with billing logic
      membershipResult = await addUserToOrganization({
        userId: session.user.id,
        organizationId,
        role: orgInvitation.role as 'admin' | 'member' | 'owner',
        skipSeatValidation: true, // Already validated via invitation flow
      })

      if (!membershipResult.success) {
        return NextResponse.json({ error: membershipResult.error }, { status: 400 })
      }

      // Update invitation status
      await db.update(invitation).set({ status }).where(eq(invitation.id, invitationId))

      // Handle linked workspace invitations
      const linkedWorkspaceInvitations = await db
        .select()
        .from(workspaceInvitation)
        .where(
          and(
            eq(workspaceInvitation.orgInvitationId, invitationId),
            eq(workspaceInvitation.status, 'pending' as WorkspaceInvitationStatus)
          )
        )

      for (const wsInvitation of linkedWorkspaceInvitations) {
        await db
          .update(workspaceInvitation)
          .set({
            status: 'accepted' as WorkspaceInvitationStatus,
            updatedAt: new Date(),
          })
          .where(eq(workspaceInvitation.id, wsInvitation.id))

        await db.insert(permissions).values({
          id: randomUUID(),
          entityType: 'workspace',
          entityId: wsInvitation.workspaceId,
          userId: session.user.id,
          permissionType: wsInvitation.permissions || 'read',
          createdAt: new Date(),
          updatedAt: new Date(),
        })
      }

      // Handle Stripe Pro subscription cancellation if needed
      const proToCancel = membershipResult.billingActions.proSubscriptionToCancel
      if (proToCancel?.stripeSubscriptionId) {
        try {
          const stripe = requireStripeClient()
          await stripe.subscriptions.update(proToCancel.stripeSubscriptionId, {
            cancel_at_period_end: true,
          })
          logger.info('Updated Stripe to cancel personal Pro at period end', {
            userId: session.user.id,
            stripeSubscriptionId: proToCancel.stripeSubscriptionId,
            organizationId,
          })
        } catch (stripeError) {
          logger.error('Failed to set cancel_at_period_end on Stripe for personal Pro', {
            userId: session.user.id,
            subscriptionId: proToCancel.subscriptionId,
            stripeSubscriptionId: proToCancel.stripeSubscriptionId,
            error: stripeError,
          })
        }
      }
    } else if (status === 'cancelled') {
      await db.update(invitation).set({ status }).where(eq(invitation.id, invitationId))
      await db
        .update(workspaceInvitation)
        .set({ status: 'cancelled' as WorkspaceInvitationStatus })
        .where(eq(workspaceInvitation.orgInvitationId, invitationId))
    } else {
      // rejected
      await db.update(invitation).set({ status }).where(eq(invitation.id, invitationId))
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
