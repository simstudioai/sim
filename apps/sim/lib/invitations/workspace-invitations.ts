import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { type InvitationMembershipIntent, permissions, user } from '@sim/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { getUserOrganization } from '@/lib/billing/organizations/membership'
import { validateSeatAvailability } from '@/lib/billing/validation/seat-management'
import { PlatformEvents } from '@/lib/core/telemetry'
import { normalizeEmail } from '@/lib/invitations/core'
import {
  cancelPendingInvitation,
  createPendingInvitation,
  findPendingGrantForWorkspaceEmail,
  sendInvitationEmail,
} from '@/lib/invitations/send'
import { captureServerEvent } from '@/lib/posthog/server'
import {
  getWorkspaceWithOwner,
  type PermissionType,
  type WorkspaceWithOwner,
} from '@/lib/workspaces/permissions/utils'
import { getWorkspaceInvitePolicy, type WorkspaceInvitePolicy } from '@/lib/workspaces/policy'
import { validateInvitationsAllowed } from '@/ee/access-control/utils/permission-check'

export interface WorkspaceInvitationContext {
  workspaceId: string
  inviterId: string
  inviterName: string
  inviterEmail?: string | null
  workspaceDetails: WorkspaceWithOwner
  invitePolicy: WorkspaceInvitePolicy
}

export interface WorkspaceInvitationResult {
  id: string
  workspaceId: string
  email: string
  permission: PermissionType
  membershipIntent: InvitationMembershipIntent
  expiresAt: Date | undefined
}

export class WorkspaceInvitationError extends Error {
  status: number
  email?: string
  upgradeRequired?: boolean

  constructor({
    message,
    status,
    email,
    upgradeRequired,
  }: {
    message: string
    status: number
    email?: string
    upgradeRequired?: boolean
  }) {
    super(message)
    this.name = 'WorkspaceInvitationError'
    this.status = status
    this.email = email
    this.upgradeRequired = upgradeRequired
  }
}

export async function prepareWorkspaceInvitationContext({
  workspaceId,
  inviterId,
  inviterName,
  inviterEmail,
}: {
  workspaceId: string
  inviterId: string
  inviterName: string
  inviterEmail?: string | null
}): Promise<WorkspaceInvitationContext> {
  await validateInvitationsAllowed(inviterId, workspaceId)

  const userPermission = await db
    .select()
    .from(permissions)
    .where(
      and(
        eq(permissions.entityId, workspaceId),
        eq(permissions.entityType, 'workspace'),
        eq(permissions.userId, inviterId),
        eq(permissions.permissionType, 'admin')
      )
    )
    .then((rows) => rows[0])

  if (!userPermission) {
    throw new WorkspaceInvitationError({
      message: 'You need admin permissions to invite users',
      status: 403,
    })
  }

  const workspaceDetails = await getWorkspaceWithOwner(workspaceId)
  if (!workspaceDetails) {
    throw new WorkspaceInvitationError({ message: 'Workspace not found', status: 404 })
  }

  const invitePolicy = await getWorkspaceInvitePolicy(workspaceDetails)
  if (!invitePolicy.allowed) {
    throw new WorkspaceInvitationError({
      message: invitePolicy.reason ?? 'Invites are disabled for this workspace.',
      status: 403,
      upgradeRequired: invitePolicy.upgradeRequired,
    })
  }

  return {
    workspaceId,
    inviterId,
    inviterName,
    inviterEmail,
    workspaceDetails,
    invitePolicy,
  }
}

export async function createWorkspaceInvitation({
  context,
  email,
  permission = 'read',
  request,
}: {
  context: WorkspaceInvitationContext
  email: string
  permission?: string
  request: NextRequest
}): Promise<WorkspaceInvitationResult> {
  const validPermissions: PermissionType[] = ['admin', 'write', 'read']
  if (!validPermissions.includes(permission as PermissionType)) {
    throw new WorkspaceInvitationError({
      message: `Invalid permission: must be one of ${validPermissions.join(', ')}`,
      status: 400,
      email,
    })
  }
  const invitationPermission = permission as PermissionType

  const normalizedEmail = normalizeEmail(email)
  let membershipIntent: InvitationMembershipIntent = 'internal'

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
          eq(permissions.entityId, context.workspaceId),
          eq(permissions.entityType, 'workspace'),
          eq(permissions.userId, existingUser.id)
        )
      )
      .then((rows) => rows[0])

    if (existingPermission) {
      throw new WorkspaceInvitationError({
        message: `${normalizedEmail} already has access to this workspace`,
        status: 400,
        email: normalizedEmail,
      })
    }

    if (context.invitePolicy.organizationId) {
      const existingMembership = await getUserOrganization(existingUser.id)
      if (
        existingMembership &&
        existingMembership.organizationId !== context.invitePolicy.organizationId
      ) {
        membershipIntent = 'external'
      } else if (context.invitePolicy.requiresSeat && !existingMembership) {
        const seatValidation = await validateSeatAvailability(
          context.invitePolicy.organizationId,
          1
        )
        if (!seatValidation.canInvite) {
          throw new WorkspaceInvitationError({
            message: seatValidation.reason || 'No available seats for this organization.',
            status: 400,
            email: normalizedEmail,
          })
        }
      }
    }
  } else if (context.invitePolicy.requiresSeat && context.invitePolicy.organizationId) {
    const seatValidation = await validateSeatAvailability(context.invitePolicy.organizationId, 1)
    if (!seatValidation.canInvite) {
      throw new WorkspaceInvitationError({
        message: seatValidation.reason || 'No available seats for this organization.',
        status: 400,
        email: normalizedEmail,
      })
    }
  }

  const existingInvitation = await findPendingGrantForWorkspaceEmail({
    workspaceId: context.workspaceId,
    email: normalizedEmail,
  })
  if (existingInvitation) {
    throw new WorkspaceInvitationError({
      message: `${normalizedEmail} has already been invited to this workspace`,
      status: 400,
      email: normalizedEmail,
    })
  }

  const { invitationId, token } = await createPendingInvitation({
    kind: 'workspace',
    email: normalizedEmail,
    inviterId: context.inviterId,
    organizationId: context.workspaceDetails.organizationId,
    membershipIntent,
    role: 'member',
    grants: [
      {
        workspaceId: context.workspaceId,
        permission: invitationPermission,
      },
    ],
  })

  try {
    PlatformEvents.workspaceMemberInvited({
      workspaceId: context.workspaceId,
      invitedBy: context.inviterId,
      inviteeEmail: normalizedEmail,
      role: invitationPermission,
      membershipIntent,
    })
  } catch {
    /**
     * Telemetry must not fail invitation creation.
     */
  }

  captureServerEvent(
    context.inviterId,
    'workspace_member_invited',
    {
      workspace_id: context.workspaceId,
      invitee_role: invitationPermission,
      membership_intent: membershipIntent,
    },
    {
      groups: { workspace: context.workspaceId },
      setOnce: { first_invitation_sent_at: new Date().toISOString() },
    }
  )

  const emailResult = await sendInvitationEmail({
    invitationId,
    token,
    kind: 'workspace',
    email: normalizedEmail,
    inviterName: context.inviterName,
    organizationId: context.workspaceDetails.organizationId,
    organizationRole: 'member',
    grants: [{ workspaceId: context.workspaceId, permission: invitationPermission }],
  })

  if (!emailResult.success) {
    await cancelPendingInvitation(invitationId)
    throw new WorkspaceInvitationError({
      message: emailResult.error || 'Failed to send invitation email',
      status: 502,
      email: normalizedEmail,
    })
  }

  recordAudit({
    workspaceId: context.workspaceId,
    actorId: context.inviterId,
    actorName: context.inviterName,
    actorEmail: context.inviterEmail,
    action: AuditAction.MEMBER_INVITED,
    resourceType: AuditResourceType.WORKSPACE,
    resourceId: context.workspaceId,
    resourceName: normalizedEmail,
    description: `Invited ${normalizedEmail} as ${invitationPermission}`,
    metadata: {
      targetEmail: normalizedEmail,
      targetRole: invitationPermission,
      membershipIntent,
      workspaceName: context.workspaceDetails.name,
      invitationId,
    },
    request,
  })

  return {
    id: invitationId,
    workspaceId: context.workspaceId,
    email: normalizedEmail,
    permission: invitationPermission,
    membershipIntent,
    expiresAt: undefined,
  }
}
