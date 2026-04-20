import { db } from '@sim/db'
import {
  invitation,
  invitationWorkspaceGrant,
  member,
  permissions,
  user,
  workspace,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { expireStalePendingInvitationsForOrganization } from '@/lib/invitations/core'

const logger = createLogger('OrganizationRosterAPI')

interface RosterWorkspaceAccess {
  workspaceId: string
  workspaceName: string
  permission: 'admin' | 'write' | 'read'
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: organizationId } = await params

    const [callerMembership] = await db
      .select({ role: member.role })
      .from(member)
      .where(and(eq(member.organizationId, organizationId), eq(member.userId, session.user.id)))
      .limit(1)

    if (!callerMembership) {
      return NextResponse.json(
        { error: 'Forbidden - Not a member of this organization' },
        { status: 403 }
      )
    }

    if (callerMembership.role !== 'owner' && callerMembership.role !== 'admin') {
      return NextResponse.json(
        { error: 'Forbidden - Organization admin access required' },
        { status: 403 }
      )
    }

    await expireStalePendingInvitationsForOrganization(organizationId)

    const orgWorkspaces = await db
      .select({ id: workspace.id, name: workspace.name })
      .from(workspace)
      .where(eq(workspace.organizationId, organizationId))

    const orgWorkspaceIds = orgWorkspaces.map((ws) => ws.id)
    const workspaceNameById = new Map(orgWorkspaces.map((ws) => [ws.id, ws.name]))

    const memberRows = await db
      .select({
        memberId: member.id,
        userId: member.userId,
        role: member.role,
        createdAt: member.createdAt,
        userName: user.name,
        userEmail: user.email,
        userImage: user.image,
      })
      .from(member)
      .innerJoin(user, eq(member.userId, user.id))
      .where(eq(member.organizationId, organizationId))

    const memberUserIds = memberRows.map((row) => row.userId)

    const memberPermissions =
      memberUserIds.length > 0 && orgWorkspaceIds.length > 0
        ? await db
            .select({
              userId: permissions.userId,
              workspaceId: permissions.entityId,
              permission: permissions.permissionType,
            })
            .from(permissions)
            .where(
              and(
                eq(permissions.entityType, 'workspace'),
                inArray(permissions.userId, memberUserIds),
                inArray(permissions.entityId, orgWorkspaceIds)
              )
            )
        : []

    const permissionsByUser = new Map<string, RosterWorkspaceAccess[]>()
    for (const row of memberPermissions) {
      const list = permissionsByUser.get(row.userId) ?? []
      list.push({
        workspaceId: row.workspaceId,
        workspaceName: workspaceNameById.get(row.workspaceId) ?? 'Workspace',
        permission: row.permission,
      })
      permissionsByUser.set(row.userId, list)
    }

    const members = memberRows.map((row) => ({
      memberId: row.memberId,
      userId: row.userId,
      role: row.role,
      createdAt: row.createdAt,
      name: row.userName,
      email: row.userEmail,
      image: row.userImage,
      workspaces: permissionsByUser.get(row.userId) ?? [],
    }))

    const pendingInvitationRows = await db
      .select({
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        kind: invitation.kind,
        createdAt: invitation.createdAt,
        expiresAt: invitation.expiresAt,
        inviteeName: user.name,
        inviteeImage: user.image,
      })
      .from(invitation)
      .leftJoin(user, sql`lower(${user.email}) = lower(${invitation.email})`)
      .where(and(eq(invitation.organizationId, organizationId), eq(invitation.status, 'pending')))

    const pendingInvitationIds = pendingInvitationRows.map((row) => row.id)
    const pendingGrants =
      pendingInvitationIds.length > 0
        ? await db
            .select({
              invitationId: invitationWorkspaceGrant.invitationId,
              workspaceId: invitationWorkspaceGrant.workspaceId,
              permission: invitationWorkspaceGrant.permission,
            })
            .from(invitationWorkspaceGrant)
            .where(inArray(invitationWorkspaceGrant.invitationId, pendingInvitationIds))
        : []

    const grantsByInvitation = new Map<string, RosterWorkspaceAccess[]>()
    for (const row of pendingGrants) {
      const list = grantsByInvitation.get(row.invitationId) ?? []
      list.push({
        workspaceId: row.workspaceId,
        workspaceName: workspaceNameById.get(row.workspaceId) ?? 'Workspace',
        permission: row.permission,
      })
      grantsByInvitation.set(row.invitationId, list)
    }

    const pendingInvitations = pendingInvitationRows.map((row) => ({
      id: row.id,
      email: row.email,
      role: row.role,
      kind: row.kind,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      inviteeName: row.inviteeName,
      inviteeImage: row.inviteeImage,
      workspaces: grantsByInvitation.get(row.id) ?? [],
    }))

    return NextResponse.json({
      success: true,
      data: {
        members,
        pendingInvitations,
        workspaces: orgWorkspaces,
      },
    })
  } catch (error) {
    logger.error('Failed to fetch organization roster', { error })
    return NextResponse.json({ error: 'Failed to fetch organization roster' }, { status: 500 })
  }
}
