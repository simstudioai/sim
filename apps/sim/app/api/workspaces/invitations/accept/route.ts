import { randomUUID } from 'crypto'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { env } from '@/lib/env'
import { db } from '@/db'
import { permissions, user, workspace, workspaceInvitation } from '@/db/schema'

// Accept an invitation via token
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')

  if (!token) {
    return NextResponse.redirect(
      new URL(
        '/invite/invite-error?reason=missing-token',
        env.NEXT_PUBLIC_APP_URL || 'https://sim.ai'
      )
    )
  }

  const session = await getSession()

  if (!session?.user?.id) {
    // No need to encode API URL as callback, just redirect to invite page
    // The middleware will handle proper login flow and return to invite page
    return NextResponse.redirect(
      new URL(`/invite/${token}?token=${token}`, env.NEXT_PUBLIC_APP_URL || 'https://sim.ai')
    )
  }

  try {
    // Find the invitation by token
    const invitation = await db
      .select()
      .from(workspaceInvitation)
      .where(eq(workspaceInvitation.token, token))
      .then((rows) => rows[0])

    if (!invitation) {
      return NextResponse.redirect(
        new URL(
          '/invite/invite-error?reason=invalid-token',
          env.NEXT_PUBLIC_APP_URL || 'https://sim.ai'
        )
      )
    }

    // Check if invitation has expired
    if (new Date() > new Date(invitation.expiresAt)) {
      return NextResponse.redirect(
        new URL('/invite/invite-error?reason=expired', env.NEXT_PUBLIC_APP_URL || 'https://sim.ai')
      )
    }

    // Check if invitation is already accepted
    if (invitation.status !== 'pending') {
      return NextResponse.redirect(
        new URL(
          '/invite/invite-error?reason=already-processed',
          env.NEXT_PUBLIC_APP_URL || 'https://sim.ai'
        )
      )
    }

    // Get the user's email from the session
    const userEmail = session.user.email.toLowerCase()
    const invitationEmail = invitation.email.toLowerCase()

    // Get user data to check email verification status and for error messages
    const userData = await db
      .select()
      .from(user)
      .where(eq(user.id, session.user.id))
      .then((rows) => rows[0])

    if (!userData) {
      return NextResponse.redirect(
        new URL(
          '/invite/invite-error?reason=user-not-found',
          env.NEXT_PUBLIC_APP_URL || 'https://sim.ai'
        )
      )
    }

    // Check if user's email is verified
    if (!userData.emailVerified) {
      return NextResponse.redirect(
        new URL(
          `/invite/invite-error?reason=email-not-verified&details=${encodeURIComponent(`You must verify your email address (${userData.email}) before accepting invitations.`)}`,
          env.NEXT_PUBLIC_APP_URL || 'https://sim.ai'
        )
      )
    }

    // Check if the logged-in user's email matches the invitation
    const isValidMatch = userEmail === invitationEmail

    if (!isValidMatch) {
      return NextResponse.redirect(
        new URL(
          `/invite/invite-error?reason=email-mismatch&details=${encodeURIComponent(`Invitation was sent to ${invitation.email}, but you're logged in as ${userData.email}`)}`,
          env.NEXT_PUBLIC_APP_URL || 'https://sim.ai'
        )
      )
    }

    // Get the workspace details
    const workspaceDetails = await db
      .select()
      .from(workspace)
      .where(eq(workspace.id, invitation.workspaceId))
      .then((rows) => rows[0])

    if (!workspaceDetails) {
      return NextResponse.redirect(
        new URL(
          '/invite/invite-error?reason=workspace-not-found',
          env.NEXT_PUBLIC_APP_URL || 'https://sim.ai'
        )
      )
    }

    // Check if user already has permissions for this workspace
    const existingPermission = await db
      .select()
      .from(permissions)
      .where(
        and(
          eq(permissions.entityId, invitation.workspaceId),
          eq(permissions.entityType, 'workspace'),
          eq(permissions.userId, session.user.id)
        )
      )
      .then((rows) => rows[0])

    if (existingPermission) {
      // User already has permissions, just mark the invitation as accepted and redirect
      await db
        .update(workspaceInvitation)
        .set({
          status: 'accepted',
          updatedAt: new Date(),
        })
        .where(eq(workspaceInvitation.id, invitation.id))

      return NextResponse.redirect(
        new URL(
          `/workspace/${invitation.workspaceId}/w`,
          env.NEXT_PUBLIC_APP_URL || 'https://sim.ai'
        )
      )
    }

    // Add user permissions and mark invitation as accepted in a transaction
    await db.transaction(async (tx) => {
      // Create permissions for the user
      await tx.insert(permissions).values({
        id: randomUUID(),
        entityType: 'workspace' as const,
        entityId: invitation.workspaceId,
        userId: session.user.id,
        permissionType: invitation.permissions || 'read',
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      // Mark invitation as accepted
      await tx
        .update(workspaceInvitation)
        .set({
          status: 'accepted',
          updatedAt: new Date(),
        })
        .where(eq(workspaceInvitation.id, invitation.id))
    })

    // Redirect to the workspace
    return NextResponse.redirect(
      new URL(`/workspace/${invitation.workspaceId}/w`, env.NEXT_PUBLIC_APP_URL || 'https://sim.ai')
    )
  } catch (error) {
    console.error('Error accepting invitation:', error)
    return NextResponse.redirect(
      new URL(
        '/invite/invite-error?reason=server-error',
        env.NEXT_PUBLIC_APP_URL || 'https://sim.ai'
      )
    )
  }
}
