import { db } from '@sim/db'
import { permissions, type permissionTypeEnum, user, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { AuditAction, AuditResourceType, recordAudit } from '@/lib/audit/log'
import { getSession } from '@/lib/auth'
import { getUserOrganization } from '@/lib/billing/organizations/membership'
import { validateSeatAvailability } from '@/lib/billing/validation/seat-management'
import { PlatformEvents } from '@/lib/core/telemetry'
import { listInvitationsForWorkspaces, normalizeEmail } from '@/lib/invitations/core'
import {
  cancelPendingInvitation,
  createPendingInvitation,
  findPendingGrantForWorkspaceEmail,
  sendInvitationEmail,
} from '@/lib/invitations/send'
import { captureServerEvent } from '@/lib/posthog/server'
import { getWorkspaceWithOwner } from '@/lib/workspaces/permissions/utils'
import { getWorkspaceInvitePolicy } from '@/lib/workspaces/policy'
import {
  InvitationsNotAllowedError,
  validateInvitationsAllowed,
} from '@/ee/access-control/utils/permission-check'

export const dynamic = 'force-dynamic'

const logger = createLogger('WorkspaceInvitationsAPI')

type PermissionType = (typeof permissionTypeEnum.enumValues)[number]

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const userWorkspaces = await db
      .select({ id: workspace.id })
      .from(workspace)
      .innerJoin(
        permissions,
        and(
          eq(permissions.entityId, workspace.id),
          eq(permissions.entityType, 'workspace'),
          eq(permissions.userId, session.user.id)
        )
      )
      .where(isNull(workspace.archivedAt))

    if (userWorkspaces.length === 0) {
      return NextResponse.json({ invitations: [] })
    }

    const invitations = await listInvitationsForWorkspaces(userWorkspaces.map((w) => w.id))
    return NextResponse.json({ invitations })
  } catch (error) {
    logger.error('Error fetching workspace invitations:', error)
    return NextResponse.json({ error: 'Failed to fetch invitations' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    await validateInvitationsAllowed(session.user.id)

    const { workspaceId, email, permission = 'read' } = await req.json()

    if (!workspaceId || !email) {
      return NextResponse.json({ error: 'Workspace ID and email are required' }, { status: 400 })
    }

    const validPermissions: PermissionType[] = ['admin', 'write', 'read']
    if (!validPermissions.includes(permission)) {
      return NextResponse.json(
        { error: `Invalid permission: must be one of ${validPermissions.join(', ')}` },
        { status: 400 }
      )
    }

    const normalizedEmail = normalizeEmail(email)

    const userPermission = await db
      .select()
      .from(permissions)
      .where(
        and(
          eq(permissions.entityId, workspaceId),
          eq(permissions.entityType, 'workspace'),
          eq(permissions.userId, session.user.id),
          eq(permissions.permissionType, 'admin')
        )
      )
      .then((rows) => rows[0])

    if (!userPermission) {
      return NextResponse.json(
        { error: 'You need admin permissions to invite users' },
        { status: 403 }
      )
    }

    const workspaceDetails = await getWorkspaceWithOwner(workspaceId)
    if (!workspaceDetails) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    }

    const invitePolicy = await getWorkspaceInvitePolicy(workspaceDetails)
    if (!invitePolicy.allowed) {
      return NextResponse.json(
        {
          error: invitePolicy.reason ?? 'Invites are disabled for this workspace.',
          upgradeRequired: invitePolicy.upgradeRequired,
        },
        { status: 403 }
      )
    }

    const existingUser = await db
      .select()
      .from(user)
      .where(sql`lower(${user.email}) = ${normalizedEmail}`)
      .then((rows) => rows[0])

    if (existingUser) {
      const existingPermission = await db
        .select()
        .from(permissions)
        .where(
          and(
            eq(permissions.entityId, workspaceId),
            eq(permissions.entityType, 'workspace'),
            eq(permissions.userId, existingUser.id)
          )
        )
        .then((rows) => rows[0])

      if (existingPermission) {
        return NextResponse.json(
          {
            error: `${normalizedEmail} already has access to this workspace`,
            email: normalizedEmail,
          },
          { status: 400 }
        )
      }

      if (invitePolicy.requiresSeat && invitePolicy.organizationId) {
        const existingMembership = await getUserOrganization(existingUser.id)
        if (
          existingMembership &&
          existingMembership.organizationId !== invitePolicy.organizationId
        ) {
          return NextResponse.json(
            {
              error:
                'This user is already a member of another organization. They must leave it before joining this workspace.',
              email: normalizedEmail,
            },
            { status: 409 }
          )
        }

        if (!existingMembership) {
          const seatValidation = await validateSeatAvailability(invitePolicy.organizationId, 1)
          if (!seatValidation.canInvite) {
            return NextResponse.json(
              {
                error: seatValidation.reason || 'No available seats for this organization.',
                email: normalizedEmail,
              },
              { status: 400 }
            )
          }
        }
      }
    } else if (invitePolicy.requiresSeat && invitePolicy.organizationId) {
      const seatValidation = await validateSeatAvailability(invitePolicy.organizationId, 1)
      if (!seatValidation.canInvite) {
        return NextResponse.json(
          {
            error: seatValidation.reason || 'No available seats for this organization.',
            email: normalizedEmail,
          },
          { status: 400 }
        )
      }
    }

    const existingInvitation = await findPendingGrantForWorkspaceEmail({
      workspaceId,
      email: normalizedEmail,
    })
    if (existingInvitation) {
      return NextResponse.json(
        {
          error: `${normalizedEmail} has already been invited to this workspace`,
          email: normalizedEmail,
        },
        { status: 400 }
      )
    }

    const { invitationId, token } = await createPendingInvitation({
      kind: 'workspace',
      email: normalizedEmail,
      inviterId: session.user.id,
      organizationId: workspaceDetails.organizationId,
      role: 'member',
      grants: [
        {
          workspaceId,
          permission,
        },
      ],
    })

    try {
      PlatformEvents.workspaceMemberInvited({
        workspaceId,
        invitedBy: session.user.id,
        inviteeEmail: normalizedEmail,
        role: permission,
      })
    } catch {
      // telemetry must not fail the operation
    }

    captureServerEvent(
      session.user.id,
      'workspace_member_invited',
      { workspace_id: workspaceId, invitee_role: permission },
      {
        groups: { workspace: workspaceId },
        setOnce: { first_invitation_sent_at: new Date().toISOString() },
      }
    )

    const emailResult = await sendInvitationEmail({
      invitationId,
      token,
      kind: 'workspace',
      email: normalizedEmail,
      inviterName: session.user.name || session.user.email || 'A user',
      organizationId: workspaceDetails.organizationId,
      organizationRole: 'member',
      grants: [{ workspaceId, permission }],
    })

    if (!emailResult.success) {
      await cancelPendingInvitation(invitationId)
      return NextResponse.json(
        { error: emailResult.error || 'Failed to send invitation email' },
        { status: 502 }
      )
    }

    recordAudit({
      workspaceId,
      actorId: session.user.id,
      actorName: session.user.name,
      actorEmail: session.user.email,
      action: AuditAction.MEMBER_INVITED,
      resourceType: AuditResourceType.WORKSPACE,
      resourceId: workspaceId,
      resourceName: normalizedEmail,
      description: `Invited ${normalizedEmail} as ${permission}`,
      metadata: {
        targetEmail: normalizedEmail,
        targetRole: permission,
        workspaceName: workspaceDetails.name,
        invitationId,
      },
      request: req,
    })

    return NextResponse.json({
      success: true,
      invitation: {
        id: invitationId,
        workspaceId,
        email: normalizedEmail,
        permission,
        expiresAt: undefined,
      },
    })
  } catch (error) {
    if (error instanceof InvitationsNotAllowedError) {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    logger.error('Error creating workspace invitation:', error)
    return NextResponse.json({ error: 'Failed to create invitation' }, { status: 500 })
  }
}
