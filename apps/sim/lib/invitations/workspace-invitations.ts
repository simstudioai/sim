import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { type InvitationMembershipIntent, permissions, user } from '@sim/db/schema'
import { normalizeEmail } from '@sim/utils/string'
import { and, eq, sql } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { getUserOrganization } from '@/lib/billing/organizations/membership'
import { validateSeatAvailability } from '@/lib/billing/validation/seat-management'
import { PlatformEvents } from '@/lib/core/telemetry'
import {
  type DirectGrantOutcome,
  grantWorkspaceAccessDirectly,
} from '@/lib/invitations/direct-grant'
import {
  cancelPendingInvitation,
  createPendingInvitation,
  findPendingGrantForWorkspaceEmail,
  sendInvitationEmail,
} from '@/lib/invitations/send'
import { captureServerEvent } from '@/lib/posthog/server'
import {
  getWorkspaceWithOwner,
  hasWorkspaceAdminAccess,
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
  /** True when the user was granted access directly (no pending invitation). */
  instantAdd?: boolean
  /** Direct-grant outcome when `instantAdd` is true. */
  outcome?: DirectGrantOutcome['outcome']
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

  const isAdmin = await hasWorkspaceAdminAccess(inviterId, workspaceId)
  if (!isAdmin) {
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

/**
 * Throws the invite-flow seat error when the organization cannot take one
 * more internal member.
 */
async function assertSeatAvailable(organizationId: string, email: string): Promise<void> {
  const seatValidation = await validateSeatAvailability(organizationId, 1)
  if (!seatValidation.canInvite) {
    throw new WorkspaceInvitationError({
      message: seatValidation.reason || 'No available seats for this organization.',
      status: 400,
      email,
    })
  }
}

export async function createWorkspaceInvitation({
  context,
  email,
  permission = 'read',
  membershipIntent: requestedIntent,
  request,
}: {
  context: WorkspaceInvitationContext
  email: string
  permission?: string
  /**
   * Explicit inviter choice for organization workspaces: `external` keeps the
   * invitee a workspace-only collaborator — no org membership, no seat, and
   * their own workspaces stay theirs. Defaults to the derived intent
   * (internal unless the invitee already belongs to another organization).
   */
  membershipIntent?: InvitationMembershipIntent
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

  /**
   * External is only meaningful when there is an organization to stay outside
   * of. On a personal workspace it would also skip the Pro→Team conversion
   * that acceptance performs, so it is rejected rather than ignored.
   */
  if (requestedIntent === 'external' && !context.workspaceDetails.organizationId) {
    throw new WorkspaceInvitationError({
      message: 'External invitations are only available on organization workspaces.',
      status: 400,
      email,
    })
  }

  const normalizedEmail = normalizeEmail(email)
  let membershipIntent: InvitationMembershipIntent =
    requestedIntent === 'external' ? 'external' : 'internal'

  const existingUser = await db
    .select()
    .from(user)
    .where(sql`lower(${user.email}) = ${normalizedEmail}`)
    .then((rows) => rows[0])

  if (existingUser) {
    const workspaceOrganizationId = context.workspaceDetails.organizationId
    const existingMembership = workspaceOrganizationId
      ? await getUserOrganization(existingUser.id)
      : null

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

    /**
     * Already a workspace member: reject. Invites never change an existing
     * member's permission — role changes go through the members list, not the
     * invite flow. (The client also blocks re-inviting current teammates.)
     */
    if (existingPermission) {
      throw new WorkspaceInvitationError({
        message: `${normalizedEmail} already has access to this workspace`,
        status: 400,
        email: normalizedEmail,
      })
    }

    /**
     * Invitee already belongs to the workspace's organization (and is not yet a
     * member of this workspace): grant access directly, with no invitation or
     * acceptance step.
     */
    if (
      workspaceOrganizationId &&
      existingMembership &&
      existingMembership.organizationId === workspaceOrganizationId
    ) {
      const directGrant = await grantWorkspaceAccessDirectly({
        userId: existingUser.id,
        email: normalizedEmail,
        workspaceId: context.workspaceId,
        workspaceName: context.workspaceDetails.name,
        permission: invitationPermission,
        organizationId: workspaceOrganizationId,
        actorId: context.inviterId,
        actorName: context.inviterName,
        actorEmail: context.inviterEmail,
        request,
      })

      return {
        id: existingUser.id,
        workspaceId: context.workspaceId,
        email: normalizedEmail,
        permission: invitationPermission,
        membershipIntent: 'internal',
        expiresAt: undefined,
        instantAdd: true,
        outcome: directGrant.outcome,
      }
    }

    if (workspaceOrganizationId) {
      if (existingMembership && existingMembership.organizationId !== workspaceOrganizationId) {
        membershipIntent = 'external'
      } else if (
        membershipIntent === 'internal' &&
        context.invitePolicy.requiresSeat &&
        !existingMembership
      ) {
        await assertSeatAvailable(workspaceOrganizationId, normalizedEmail)
      }
    }
  } else if (
    membershipIntent === 'internal' &&
    context.invitePolicy.requiresSeat &&
    context.invitePolicy.organizationId
  ) {
    await assertSeatAvailable(context.invitePolicy.organizationId, normalizedEmail)
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
