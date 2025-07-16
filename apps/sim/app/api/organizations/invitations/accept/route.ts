import { randomUUID } from 'crypto'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import { invitation, member, permissions, workspaceInvitation } from '@/db/schema'

const logger = createLogger('OrganizationInvitationAcceptance')

// Accept an organization invitation and any associated workspace invitations
export async function GET(req: NextRequest) {
  const invitationId = req.nextUrl.searchParams.get('id')

  if (!invitationId) {
    return NextResponse.redirect(
      new URL(
        '/invite/invite-error?reason=missing-invitation-id',
        env.NEXT_PUBLIC_APP_URL || 'https://simstudio.ai'
      )
    )
  }

  const session = await getSession()

  if (!session?.user?.id) {
    // Redirect to login, user will be redirected back after login
    return NextResponse.redirect(
      new URL(
        `/invite/organization?id=${invitationId}`,
        env.NEXT_PUBLIC_APP_URL || 'https://simstudio.ai'
      )
    )
  }

  try {
    // Find the organization invitation
    const invitationResult = await db
      .select()
      .from(invitation)
      .where(eq(invitation.id, invitationId))
      .limit(1)

    if (invitationResult.length === 0) {
      return NextResponse.redirect(
        new URL(
          '/invite/invite-error?reason=invalid-invitation',
          env.NEXT_PUBLIC_APP_URL || 'https://simstudio.ai'
        )
      )
    }

    const orgInvitation = invitationResult[0]

    // Check if invitation has expired
    if (orgInvitation.expiresAt && new Date() > orgInvitation.expiresAt) {
      return NextResponse.redirect(
        new URL(
          '/invite/invite-error?reason=expired',
          env.NEXT_PUBLIC_APP_URL || 'https://simstudio.ai'
        )
      )
    }

    // Check if invitation is still pending
    if (orgInvitation.status !== 'pending') {
      return NextResponse.redirect(
        new URL(
          '/invite/invite-error?reason=already-processed',
          env.NEXT_PUBLIC_APP_URL || 'https://simstudio.ai'
        )
      )
    }

    // Verify the email matches the current user
    if (orgInvitation.email !== session.user.email) {
      return NextResponse.redirect(
        new URL(
          '/invite/invite-error?reason=email-mismatch',
          env.NEXT_PUBLIC_APP_URL || 'https://simstudio.ai'
        )
      )
    }

    // Check if user is already a member of the organization
    const existingMember = await db
      .select()
      .from(member)
      .where(
        and(
          eq(member.organizationId, orgInvitation.organizationId),
          eq(member.userId, session.user.id)
        )
      )
      .limit(1)

    if (existingMember.length > 0) {
      return NextResponse.redirect(
        new URL(
          '/invite/invite-error?reason=already-member',
          env.NEXT_PUBLIC_APP_URL || 'https://simstudio.ai'
        )
      )
    }

    // Start transaction to accept both organization and workspace invitations
    await db.transaction(async (tx) => {
      // Accept organization invitation - add user as member
      await tx.insert(member).values({
        id: randomUUID(),
        userId: session.user.id,
        organizationId: orgInvitation.organizationId,
        role: orgInvitation.role,
        createdAt: new Date(),
      })

      // Mark organization invitation as accepted
      await tx.update(invitation).set({ status: 'accepted' }).where(eq(invitation.id, invitationId))

      // Find and accept any pending workspace invitations for the same email
      const workspaceInvitations = await tx
        .select()
        .from(workspaceInvitation)
        .where(
          and(
            eq(workspaceInvitation.email, orgInvitation.email),
            eq(workspaceInvitation.status, 'pending')
          )
        )

      for (const wsInvitation of workspaceInvitations) {
        // Check if invitation hasn't expired
        if (
          wsInvitation.expiresAt &&
          new Date().toISOString() <= wsInvitation.expiresAt.toISOString()
        ) {
          // Check if user doesn't already have permissions on the workspace
          const existingPermission = await tx
            .select()
            .from(permissions)
            .where(
              and(
                eq(permissions.userId, session.user.id),
                eq(permissions.entityType, 'workspace'),
                eq(permissions.entityId, wsInvitation.workspaceId)
              )
            )
            .limit(1)

          if (existingPermission.length === 0) {
            // Add workspace permissions
            await tx.insert(permissions).values({
              id: randomUUID(),
              userId: session.user.id,
              entityType: 'workspace',
              entityId: wsInvitation.workspaceId,
              permissionType: wsInvitation.permissions,
              createdAt: new Date(),
              updatedAt: new Date(),
            })

            // Mark workspace invitation as accepted
            await tx
              .update(workspaceInvitation)
              .set({ status: 'accepted' })
              .where(eq(workspaceInvitation.id, wsInvitation.id))

            logger.info('Accepted workspace invitation', {
              workspaceId: wsInvitation.workspaceId,
              userId: session.user.id,
              permission: wsInvitation.permissions,
            })
          }
        }
      }
    })

    logger.info('Successfully accepted batch invitation', {
      organizationId: orgInvitation.organizationId,
      userId: session.user.id,
      role: orgInvitation.role,
    })

    // Redirect to success page or main app
    return NextResponse.redirect(
      new URL('/workspaces?invite=accepted', env.NEXT_PUBLIC_APP_URL || 'https://simstudio.ai')
    )
  } catch (error) {
    logger.error('Failed to accept organization invitation', {
      invitationId,
      userId: session.user.id,
      error,
    })

    return NextResponse.redirect(
      new URL(
        '/invite/invite-error?reason=server-error',
        env.NEXT_PUBLIC_APP_URL || 'https://simstudio.ai'
      )
    )
  }
}

// POST endpoint for programmatic acceptance (for API use)
export async function POST(req: NextRequest) {
  const session = await getSession()

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { invitationId } = await req.json()

    if (!invitationId) {
      return NextResponse.json({ error: 'Missing invitationId' }, { status: 400 })
    }

    // Similar logic to GET but return JSON response
    const invitationResult = await db
      .select()
      .from(invitation)
      .where(eq(invitation.id, invitationId))
      .limit(1)

    if (invitationResult.length === 0) {
      return NextResponse.json({ error: 'Invalid invitation' }, { status: 404 })
    }

    const orgInvitation = invitationResult[0]

    if (orgInvitation.expiresAt && new Date() > orgInvitation.expiresAt) {
      return NextResponse.json({ error: 'Invitation expired' }, { status: 400 })
    }

    if (orgInvitation.status !== 'pending') {
      return NextResponse.json({ error: 'Invitation already processed' }, { status: 400 })
    }

    if (orgInvitation.email !== session.user.email) {
      return NextResponse.json({ error: 'Email mismatch' }, { status: 403 })
    }

    // Check if user is already a member
    const existingMember = await db
      .select()
      .from(member)
      .where(
        and(
          eq(member.organizationId, orgInvitation.organizationId),
          eq(member.userId, session.user.id)
        )
      )
      .limit(1)

    if (existingMember.length > 0) {
      return NextResponse.json({ error: 'Already a member' }, { status: 400 })
    }

    let acceptedWorkspaces = 0

    // Accept invitations in transaction
    await db.transaction(async (tx) => {
      // Accept organization invitation
      await tx.insert(member).values({
        id: randomUUID(),
        userId: session.user.id,
        organizationId: orgInvitation.organizationId,
        role: orgInvitation.role,
        createdAt: new Date(),
      })

      await tx.update(invitation).set({ status: 'accepted' }).where(eq(invitation.id, invitationId))

      // Accept workspace invitations
      const workspaceInvitations = await tx
        .select()
        .from(workspaceInvitation)
        .where(
          and(
            eq(workspaceInvitation.email, orgInvitation.email),
            eq(workspaceInvitation.status, 'pending')
          )
        )

      for (const wsInvitation of workspaceInvitations) {
        if (
          wsInvitation.expiresAt &&
          new Date().toISOString() <= wsInvitation.expiresAt.toISOString()
        ) {
          const existingPermission = await tx
            .select()
            .from(permissions)
            .where(
              and(
                eq(permissions.userId, session.user.id),
                eq(permissions.entityType, 'workspace'),
                eq(permissions.entityId, wsInvitation.workspaceId)
              )
            )
            .limit(1)

          if (existingPermission.length === 0) {
            await tx.insert(permissions).values({
              id: randomUUID(),
              userId: session.user.id,
              entityType: 'workspace',
              entityId: wsInvitation.workspaceId,
              permissionType: wsInvitation.permissions,
              createdAt: new Date(),
              updatedAt: new Date(),
            })

            await tx
              .update(workspaceInvitation)
              .set({ status: 'accepted' })
              .where(eq(workspaceInvitation.id, wsInvitation.id))

            acceptedWorkspaces++
          }
        }
      }
    })

    return NextResponse.json({
      success: true,
      message: `Successfully joined organization and ${acceptedWorkspaces} workspace(s)`,
      organizationId: orgInvitation.organizationId,
      workspacesJoined: acceptedWorkspaces,
    })
  } catch (error) {
    logger.error('Failed to accept organization invitation via API', { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
