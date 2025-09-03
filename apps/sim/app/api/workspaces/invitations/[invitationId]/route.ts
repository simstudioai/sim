import { randomUUID } from 'crypto'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { env } from '@/lib/env'
import { hasWorkspaceAdminAccess } from '@/lib/permissions/utils'
import { db } from '@/db'
import {
  permissions,
  user,
  type WorkspaceInvitationStatus,
  workspace,
  workspaceInvitation,
} from '@/db/schema'

// GET /api/workspaces/invitations/[invitationId] - Get invitation details OR accept via token
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ invitationId: string }> }
) {
  const { invitationId } = await params
  const session = await getSession()
  const token = req.nextUrl.searchParams.get('token')
  const isAcceptFlow = !!token // If token is provided, this is an acceptance flow

  if (!session?.user?.id) {
    // For token-based acceptance flows, redirect to login
    if (isAcceptFlow) {
      return NextResponse.redirect(
        new URL(
          `/invite/${invitationId}?token=${token}`,
          env.NEXT_PUBLIC_APP_URL || 'https://sim.ai'
        )
      )
    }
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const whereClause = token
      ? eq(workspaceInvitation.token, token)
      : eq(workspaceInvitation.id, invitationId)

    const invitation = await db
      .select()
      .from(workspaceInvitation)
      .where(whereClause)
      .then((rows) => rows[0])

    if (!invitation) {
      return NextResponse.json({ error: 'Invitation not found or has expired' }, { status: 404 })
    }

    if (new Date() > new Date(invitation.expiresAt)) {
      if (isAcceptFlow) {
        return NextResponse.redirect(
          new URL(
            `/invite/${invitation.id}?error=expired`,
            env.NEXT_PUBLIC_APP_URL || 'https://sim.ai'
          )
        )
      }
      return NextResponse.json({ error: 'Invitation has expired' }, { status: 400 })
    }

    const workspaceDetails = await db
      .select()
      .from(workspace)
      .where(eq(workspace.id, invitation.workspaceId))
      .then((rows) => rows[0])

    if (!workspaceDetails) {
      if (isAcceptFlow) {
        return NextResponse.redirect(
          new URL(
            `/invite/${invitation.id}?error=workspace-not-found`,
            env.NEXT_PUBLIC_APP_URL || 'https://sim.ai'
          )
        )
      }
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    }

    if (isAcceptFlow) {
      if (invitation.status !== ('pending' as WorkspaceInvitationStatus)) {
        return NextResponse.redirect(
          new URL(
            `/invite/${invitation.id}?error=already-processed`,
            env.NEXT_PUBLIC_APP_URL || 'https://sim.ai'
          )
        )
      }

      const userEmail = session.user.email.toLowerCase()
      const invitationEmail = invitation.email.toLowerCase()

      const userData = await db
        .select()
        .from(user)
        .where(eq(user.id, session.user.id))
        .then((rows) => rows[0])

      if (!userData) {
        return NextResponse.redirect(
          new URL(
            `/invite/${invitation.id}?error=user-not-found`,
            env.NEXT_PUBLIC_APP_URL || 'https://sim.ai'
          )
        )
      }

      const isValidMatch = userEmail === invitationEmail

      if (!isValidMatch) {
        return NextResponse.redirect(
          new URL(
            `/invite/${invitation.id}?error=email-mismatch`,
            env.NEXT_PUBLIC_APP_URL || 'https://sim.ai'
          )
        )
      }

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
        await db
          .update(workspaceInvitation)
          .set({
            status: 'accepted' as WorkspaceInvitationStatus,
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

      await db.transaction(async (tx) => {
        await tx.insert(permissions).values({
          id: randomUUID(),
          entityType: 'workspace' as const,
          entityId: invitation.workspaceId,
          userId: session.user.id,
          permissionType: invitation.permissions || 'read',
          createdAt: new Date(),
          updatedAt: new Date(),
        })

        await tx
          .update(workspaceInvitation)
          .set({
            status: 'accepted' as WorkspaceInvitationStatus,
            updatedAt: new Date(),
          })
          .where(eq(workspaceInvitation.id, invitation.id))
      })

      return NextResponse.redirect(
        new URL(
          `/workspace/${invitation.workspaceId}/w`,
          env.NEXT_PUBLIC_APP_URL || 'https://sim.ai'
        )
      )
    }

    return NextResponse.json({
      ...invitation,
      workspaceName: workspaceDetails.name,
    })
  } catch (error) {
    console.error('Error fetching workspace invitation:', error)
    return NextResponse.json({ error: 'Failed to fetch invitation details' }, { status: 500 })
  }
}

// DELETE /api/workspaces/invitations/[invitationId] - Delete a workspace invitation
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ invitationId: string }> }
) {
  const { invitationId } = await params
  const session = await getSession()

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const invitation = await db
      .select({
        id: workspaceInvitation.id,
        workspaceId: workspaceInvitation.workspaceId,
        email: workspaceInvitation.email,
        inviterId: workspaceInvitation.inviterId,
        status: workspaceInvitation.status,
      })
      .from(workspaceInvitation)
      .where(eq(workspaceInvitation.id, invitationId))
      .then((rows) => rows[0])

    if (!invitation) {
      return NextResponse.json({ error: 'Invitation not found' }, { status: 404 })
    }

    const hasAdminAccess = await hasWorkspaceAdminAccess(session.user.id, invitation.workspaceId)

    if (!hasAdminAccess) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    if (invitation.status !== ('pending' as WorkspaceInvitationStatus)) {
      return NextResponse.json({ error: 'Can only delete pending invitations' }, { status: 400 })
    }

    await db.delete(workspaceInvitation).where(eq(workspaceInvitation.id, invitationId))

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting workspace invitation:', error)
    return NextResponse.json({ error: 'Failed to delete invitation' }, { status: 500 })
  }
}
