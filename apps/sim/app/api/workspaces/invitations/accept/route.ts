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
    // Redirect to a page explaining the error
    return NextResponse.redirect(
      new URL(
        '/invite/invite-error?reason=missing-token',
        env.NEXT_PUBLIC_APP_URL || 'https://simstudio.ai'
      )
    )
  }

  const session = await getSession()

  if (!session?.user?.id) {
    // No need to encode API URL as callback, just redirect to invite page
    // The middleware will handle proper login flow and return to invite page
    return NextResponse.redirect(
      new URL(`/invite/${token}?token=${token}`, env.NEXT_PUBLIC_APP_URL || 'https://simstudio.ai')
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
          env.NEXT_PUBLIC_APP_URL || 'https://simstudio.ai'
        )
      )
    }

    // Check if invitation has expired
    if (new Date() > new Date(invitation.expiresAt)) {
      return NextResponse.redirect(
        new URL(
          '/invite/invite-error?reason=expired',
          env.NEXT_PUBLIC_APP_URL || 'https://simstudio.ai'
        )
      )
    }

    // Check if invitation is already accepted
    if (invitation.status !== 'pending') {
      return NextResponse.redirect(
        new URL(
          '/invite/invite-error?reason=already-processed',
          env.NEXT_PUBLIC_APP_URL || 'https://simstudio.ai'
        )
      )
    }

    // Get the user's email from the session
    const userEmail = session.user.email.toLowerCase()
    const invitationEmail = invitation.email.toLowerCase()

    // Check if the logged-in user's email matches the invitation
    // We'll use exact matching as the primary check
    const isExactMatch = userEmail === invitationEmail

    // For SSO or company email variants, check domain and normalized username
    // This handles cases like john.doe@company.com vs john@company.com
    const normalizeUsername = (email: string): string => {
      return email
        .split('@')[0]
        .replace(/[^a-zA-Z0-9]/g, '')
        .toLowerCase()
    }

    const isSameDomain = userEmail.split('@')[1] === invitationEmail.split('@')[1]
    const normalizedUserEmail = normalizeUsername(userEmail)
    const normalizedInvitationEmail = normalizeUsername(invitationEmail)
    const isSimilarUsername =
      normalizedUserEmail === normalizedInvitationEmail ||
      normalizedUserEmail.includes(normalizedInvitationEmail) ||
      normalizedInvitationEmail.includes(normalizedUserEmail)

    const isValidMatch = isExactMatch || (isSameDomain && isSimilarUsername)

    if (!isValidMatch) {
      // Get user info to include in the error message
      const userData = await db
        .select()
        .from(user)
        .where(eq(user.id, session.user.id))
        .then((rows) => rows[0])

      return NextResponse.redirect(
        new URL(
          `/invite/invite-error?reason=email-mismatch&details=${encodeURIComponent(`Invitation was sent to ${invitation.email}, but you're logged in as ${userData?.email || session.user.email}`)}`,
          env.NEXT_PUBLIC_APP_URL || 'https://simstudio.ai'
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
          env.NEXT_PUBLIC_APP_URL || 'https://simstudio.ai'
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
          env.NEXT_PUBLIC_APP_URL || 'https://simstudio.ai'
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
      new URL(
        `/workspace/${invitation.workspaceId}/w`,
        env.NEXT_PUBLIC_APP_URL || 'https://simstudio.ai'
      )
    )
  } catch (error) {
    console.error('Error accepting invitation:', error)
    return NextResponse.redirect(
      new URL(
        '/invite/invite-error?reason=server-error',
        env.NEXT_PUBLIC_APP_URL || 'https://simstudio.ai'
      )
    )
  }
}
