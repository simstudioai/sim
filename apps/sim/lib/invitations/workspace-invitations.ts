import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { type InvitationMembershipIntent, permissions, user } from '@sim/db/schema'
import { normalizeEmail } from '@sim/utils/string'
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { getUserOrganization } from '@/lib/billing/organizations/membership'
import { validateSeatAvailability } from '@/lib/billing/validation/seat-management'
import { PlatformEvents } from '@/lib/core/telemetry'
import {
  type DirectGrantOutcome,
  grantWorkspaceAccessDirectly,
} from '@/lib/invitations/direct-grant'
import {
  ConflictingPendingInvitationError,
  cancelPendingInvitation,
  createPendingInvitation,
  findPendingGrantWorkspaceIds,
  revertPendingInvitationGrants,
  sendInvitationEmail,
} from '@/lib/invitations/send'
import { captureServerEvent } from '@/lib/posthog/server'
import {
  getWorkspaceWithOwner,
  hasWorkspaceAdminAccess,
  type PermissionType,
  type WorkspaceWithOwner,
} from '@/lib/workspaces/permissions/utils'
import {
  getInvitePlanCategoryForUser,
  getWorkspaceInvitePolicy,
  type WorkspaceInvitePolicy,
} from '@/lib/workspaces/policy'
import { validateInvitationsAllowed } from '@/ee/access-control/utils/permission-check'

/**
 * What the invitee becomes in the organization. `member` and `admin` are
 * organization roles and consume a seat; `external` grants the workspaces only.
 */
export type InvitationMembership = 'member' | 'admin' | 'external'

/** One authorized target workspace of an invitation. */
export interface WorkspaceInvitationTarget {
  workspaceId: string
  workspaceDetails: WorkspaceWithOwner
  invitePolicy: WorkspaceInvitePolicy
}

export interface WorkspaceInvitationContext {
  inviterId: string
  inviterName: string
  inviterEmail?: string | null
  /** Every target shares one organization scope; see `prepareWorkspaceInvitationContext`. */
  targets: WorkspaceInvitationTarget[]
  /** The organization all targets belong to, or null for a personal workspace. */
  organizationId: string | null
}

export interface WorkspaceInvitationResult {
  id: string
  email: string
  /** Workspaces this call granted or invited to; excludes ones already covered. */
  workspaceIds: string[]
  permission: PermissionType
  membershipIntent: InvitationMembershipIntent
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

/**
 * Authorizes the inviter on every target workspace and resolves the shared
 * organization scope. Mixing scopes is rejected: one invitation carries one
 * organization stamp, and a personal workspace has none to give.
 */
export async function prepareWorkspaceInvitationContext({
  workspaceIds,
  inviterId,
  inviterName,
  inviterEmail,
}: {
  workspaceIds: string[]
  inviterId: string
  inviterName: string
  inviterEmail?: string | null
}): Promise<WorkspaceInvitationContext> {
  const uniqueWorkspaceIds = [...new Set(workspaceIds)]
  if (uniqueWorkspaceIds.length === 0) {
    throw new WorkspaceInvitationError({ message: 'Select at least one workspace', status: 400 })
  }

  const targets: WorkspaceInvitationTarget[] = []
  for (const workspaceId of uniqueWorkspaceIds) {
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

    targets.push({ workspaceId, workspaceDetails, invitePolicy })
  }

  const organizationId = targets[0].workspaceDetails.organizationId
  if (targets.some((target) => target.workspaceDetails.organizationId !== organizationId)) {
    throw new WorkspaceInvitationError({
      message: 'Select workspaces from a single organization',
      status: 400,
    })
  }
  if (!organizationId && targets.length > 1) {
    throw new WorkspaceInvitationError({
      message: 'Personal workspaces can only be invited to one at a time',
      status: 400,
    })
  }

  return { inviterId, inviterName, inviterEmail, targets, organizationId }
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

/**
 * External collaborators hold workspace access without consuming a seat, so
 * the economics only work when the invitee already pays Sim somewhere else —
 * their own Pro/Max plan, or an organization that seats them. Admitting a free
 * account as external would be unmetered platform access nobody pays for, so
 * they must be invited as a Member or Admin instead.
 */
async function inviteeCanBeExternal(userId: string | undefined): Promise<boolean> {
  if (!userId) return false
  return (await getInvitePlanCategoryForUser(userId)) !== 'free'
}

/**
 * Invites one person to every workspace in the context they do not already
 * have (or already have a pending invitation for), as a single invitation with
 * one grant per workspace and one email.
 */
export async function createWorkspaceInvitation({
  context,
  email,
  permission = 'read',
  membership = 'member',
  request,
}: {
  context: WorkspaceInvitationContext
  email: string
  permission?: string
  /**
   * The inviter's choice of what the invitee becomes. `external` is rejected
   * for free accounts and on personal workspaces; it is also applied
   * automatically, whatever was asked for, when the invitee already belongs to
   * a different organization — Sim accounts belong to at most one.
   */
  membership?: InvitationMembership
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
  const organizationId = context.organizationId
  const allWorkspaceIds = context.targets.map((target) => target.workspaceId)

  const existingUser = await db
    .select({ id: user.id })
    .from(user)
    .where(sql`lower(${user.email}) = ${normalizedEmail}`)
    .then((rows) => rows[0])

  const existingMembership =
    existingUser && organizationId ? await getUserOrganization(existingUser.id) : null

  let pendingTargets = context.targets
  if (existingUser) {
    const accessibleRows = await db
      .select({ workspaceId: permissions.entityId })
      .from(permissions)
      .where(
        and(
          eq(permissions.entityType, 'workspace'),
          eq(permissions.userId, existingUser.id),
          inArray(permissions.entityId, allWorkspaceIds)
        )
      )
    const accessibleWorkspaceIds = new Set(accessibleRows.map((row) => row.workspaceId))

    /**
     * Invites never change an existing member's permission — role changes go
     * through the members list — so workspaces they already hold are dropped
     * rather than failing the whole invitation.
     */
    pendingTargets = context.targets.filter(
      (target) => !accessibleWorkspaceIds.has(target.workspaceId)
    )
    if (pendingTargets.length === 0) {
      throw new WorkspaceInvitationError({
        message: `${normalizedEmail} already has access to ${
          context.targets.length === 1 ? 'this workspace' : 'every selected workspace'
        }`,
        status: 400,
        email: normalizedEmail,
      })
    }

    /**
     * Already in this organization: they hold a seat, so grant access directly
     * with no invitation or acceptance step.
     */
    if (organizationId && existingMembership?.organizationId === organizationId) {
      let outcome: DirectGrantOutcome['outcome'] = 'unchanged'
      for (const target of pendingTargets) {
        const directGrant = await grantWorkspaceAccessDirectly({
          userId: existingUser.id,
          email: normalizedEmail,
          workspaceId: target.workspaceId,
          workspaceName: target.workspaceDetails.name,
          permission: invitationPermission,
          organizationId,
          actorId: context.inviterId,
          actorName: context.inviterName,
          actorEmail: context.inviterEmail,
          request,
        })
        if (directGrant.outcome === 'added') outcome = 'added'
      }

      return {
        id: existingUser.id,
        email: normalizedEmail,
        workspaceIds: pendingTargets.map((target) => target.workspaceId),
        permission: invitationPermission,
        membershipIntent: 'internal',
        instantAdd: true,
        outcome,
      }
    }
  }

  /**
   * An invitee who already belongs to a different organization cannot join
   * this one, so the invitation becomes external whatever the inviter chose.
   */
  const forcedExternal = Boolean(
    organizationId && existingMembership && existingMembership.organizationId !== organizationId
  )

  let membershipIntent: InvitationMembershipIntent = 'internal'
  if (forcedExternal) {
    membershipIntent = 'external'
  } else if (membership === 'external') {
    if (!organizationId) {
      throw new WorkspaceInvitationError({
        message: 'External collaborators are only available on organization workspaces.',
        status: 400,
        email: normalizedEmail,
      })
    }
    if (!(await inviteeCanBeExternal(existingUser?.id))) {
      throw new WorkspaceInvitationError({
        message: `${normalizedEmail} is not on a paid Sim plan, so they cannot be added as an external collaborator. Invite them as a Member or Admin instead — that adds a seat.`,
        status: 400,
        email: normalizedEmail,
      })
    }
    membershipIntent = 'external'
  }

  const role: 'admin' | 'member' =
    membershipIntent === 'internal' && membership === 'admin' ? 'admin' : 'member'

  /**
   * Only internal invitees take a seat, and only Enterprise reserves one at
   * invite time (`requiresSeat`) — Team seats are provisioned on acceptance.
   */
  if (
    membershipIntent === 'internal' &&
    organizationId &&
    context.targets[0].invitePolicy.requiresSeat
  ) {
    await assertSeatAvailable(organizationId, normalizedEmail)
  }

  /**
   * Workspaces already covered by a pending invitation are dropped so the
   * remaining ones still go out; re-inviting to only those is the duplicate.
   */
  const alreadyPendingWorkspaceIds = await findPendingGrantWorkspaceIds({
    workspaceIds: pendingTargets.map((target) => target.workspaceId),
    email: normalizedEmail,
  })
  const newTargets = pendingTargets.filter(
    (target) => !alreadyPendingWorkspaceIds.has(target.workspaceId)
  )
  if (newTargets.length === 0) {
    throw new WorkspaceInvitationError({
      message: `${normalizedEmail} has already been invited to ${
        pendingTargets.length === 1 ? 'this workspace' : 'every selected workspace'
      }`,
      status: 400,
      email: normalizedEmail,
    })
  }
  const newWorkspaceIds = newTargets.map((target) => target.workspaceId)

  let invitationRecord: Awaited<ReturnType<typeof createPendingInvitation>>
  try {
    invitationRecord = await createPendingInvitation({
      kind: 'workspace',
      email: normalizedEmail,
      inviterId: context.inviterId,
      organizationId,
      membershipIntent,
      role,
      grants: newTargets.map((target) => ({
        workspaceId: target.workspaceId,
        permission: invitationPermission,
      })),
    })
  } catch (error) {
    /**
     * The new workspaces would merge into a pending invitation granting a
     * different standing; surface it to the inviter instead of silently
     * picking one.
     */
    if (error instanceof ConflictingPendingInvitationError) {
      throw new WorkspaceInvitationError({
        message: error.message,
        status: 400,
        email: normalizedEmail,
      })
    }
    throw error
  }

  const invitedAt = new Date().toISOString()
  for (const target of newTargets) {
    try {
      PlatformEvents.workspaceMemberInvited({
        workspaceId: target.workspaceId,
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
        workspace_id: target.workspaceId,
        invitee_role: invitationPermission,
        membership_intent: membershipIntent,
      },
      {
        groups: { workspace: target.workspaceId },
        setOnce: { first_invitation_sent_at: invitedAt },
      }
    )
  }

  /**
   * The email covers every workspace the invitation now grants, including ones
   * merged in from an earlier invite, so one link explains all of them.
   */
  const emailResult = await sendInvitationEmail({
    invitationId: invitationRecord.invitationId,
    token: invitationRecord.token,
    kind: 'workspace',
    email: normalizedEmail,
    inviterName: context.inviterName,
    organizationId,
    organizationRole: role,
    grants: invitationRecord.grants,
  })

  if (!emailResult.success) {
    if (invitationRecord.created) {
      await cancelPendingInvitation(invitationRecord.invitationId)
    } else {
      await revertPendingInvitationGrants({
        invitationId: invitationRecord.invitationId,
        workspaceIds: invitationRecord.addedWorkspaceIds,
      })
    }
    throw new WorkspaceInvitationError({
      message: emailResult.error || 'Failed to send invitation email',
      status: 502,
      email: normalizedEmail,
    })
  }

  for (const target of newTargets) {
    recordAudit({
      workspaceId: target.workspaceId,
      actorId: context.inviterId,
      actorName: context.inviterName,
      actorEmail: context.inviterEmail,
      action: AuditAction.MEMBER_INVITED,
      resourceType: AuditResourceType.WORKSPACE,
      resourceId: target.workspaceId,
      resourceName: normalizedEmail,
      description: `Invited ${normalizedEmail} as ${invitationPermission}`,
      metadata: {
        targetEmail: normalizedEmail,
        targetRole: invitationPermission,
        membershipIntent,
        organizationRole: role,
        workspaceName: target.workspaceDetails.name,
        invitationId: invitationRecord.invitationId,
      },
      request,
    })
  }

  return {
    id: invitationRecord.invitationId,
    email: normalizedEmail,
    workspaceIds: newWorkspaceIds,
    permission: invitationPermission,
    membershipIntent,
  }
}
