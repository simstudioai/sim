import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { and, eq } from 'drizzle-orm'
import { getSession } from '@/lib/auth'
import { db } from '@/db'
import { user, workspace, workspaceInvitation, workspaceMember } from '@/db/schema'

// GET /api/workspaces/invitations/accept - Accept an invitation via token
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')

  if (!token) {
    // Redirect to a page explaining the error
    return NextResponse.redirect(
      new URL(
        '/invite/invite-error?reason=missing-token',
        process.env.NEXT_PUBLIC_APP_URL || 'https://simstudio.ai'
      )
    )
  }

  const session = await getSession()

  if (!session?.user?.id) {
    // No need to encode API URL as callback, just redirect to invite page
    // The middleware will handle proper login flow and return to invite page
    return NextResponse.redirect(
      new URL(
        `/invite/${token}?token=${token}`,
        process.env.NEXT_PUBLIC_APP_URL || 'https://simstudio.ai'
      )
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
          process.env.NEXT_PUBLIC_APP_URL || 'https://simstudio.ai'
        )
      )
    }

    // Check if invitation has expired
    if (new Date() > new Date(invitation.expiresAt)) {
      return NextResponse.redirect(
        new URL(
          '/invite/invite-error?reason=expired',
          process.env.NEXT_PUBLIC_APP_URL || 'https://simstudio.ai'
        )
      )
    }

    // Check if invitation is already accepted
    if (invitation.status !== 'pending') {
      return NextResponse.redirect(
        new URL(
          '/invite/invite-error?reason=already-processed',
          process.env.NEXT_PUBLIC_APP_URL || 'https://simstudio.ai'
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
          process.env.NEXT_PUBLIC_APP_URL || 'https://simstudio.ai'
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
          process.env.NEXT_PUBLIC_APP_URL || 'https://simstudio.ai'
        )
      )
    }

    // Check if user is already a member
    const existingMembership = await db
      .select()
      .from(workspaceMember)
      .where(
        and(
          eq(workspaceMember.workspaceId, invitation.workspaceId),
          eq(workspaceMember.userId, session.user.id)
        )
      )
      .then((rows) => rows[0])

    if (existingMembership) {
      // User is already a member, just mark the invitation as accepted and redirect
      await db
        .update(workspaceInvitation)
        .set({
          status: 'accepted',
          updatedAt: new Date(),
        })
        .where(eq(workspaceInvitation.id, invitation.id))

      return NextResponse.redirect(
        new URL(
          `/w/${invitation.workspaceId}`,
          process.env.NEXT_PUBLIC_APP_URL || 'https://simstudio.ai'
        )
      )
    }

    // Add user to workspace
    await db.insert(workspaceMember).values({
      id: randomUUID(),
      workspaceId: invitation.workspaceId,
      userId: session.user.id,
      role: invitation.role,
      joinedAt: new Date(),
      updatedAt: new Date(),
    })

    // Mark invitation as accepted
    await db
      .update(workspaceInvitation)
      .set({
        status: 'accepted',
        updatedAt: new Date(),
      })
      .where(eq(workspaceInvitation.id, invitation.id))

    // Redirect to the workspace
    return NextResponse.redirect(
      new URL(
        `/w/${invitation.workspaceId}`,
        process.env.NEXT_PUBLIC_APP_URL || 'https://simstudio.ai'
      )
    )
  } catch (error) {
    console.error('Error accepting invitation:', error)
    return NextResponse.redirect(
      new URL(
        '/invite/invite-error?reason=server-error',
        process.env.NEXT_PUBLIC_APP_URL || 'https://simstudio.ai'
      )
    )
  }
}
