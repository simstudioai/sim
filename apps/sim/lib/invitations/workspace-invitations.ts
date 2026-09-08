import { AuditAction, AuditResourceType, recordAudit, recordAuditOnce } from '@sim/audit'
import { db } from '@sim/db'
import { type InvitationMembershipIntent, member, permissions, user } from '@sim/db/schema'
import { isOrgAdminRole, permissionSatisfies } from '@sim/platform-authz/workspace'
import { normalizeEmail } from '@sim/utils/string'
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { isOrganizationOwnerOrAdmin } from '@/lib/billing/core/organization'
import {
  acquireOrganizationMutationLock,
  acquireOrganizationUserMutationLocks,
  getUserOrganization,
} from '@/lib/billing/organizations/membership'
import { validateSeatAvailability } from '@/lib/billing/validation/seat-management'
import { isBillingEnabled } from '@/lib/core/config/env-flags'
import { PlatformEvents } from '@/lib/core/telemetry'
import type { DbOrTx } from '@/lib/db/types'
import {
  DirectGrantContextChangedError,
  type DirectGrantOutcome,
  grantWorkspaceAccessDirectly,
} from '@/lib/invitations/direct-grant'
import {
  ConflictingPendingInvitationError,
  cancelPendingInvitation,
  createPendingInvitation,
  findPendingGrantWorkspaceIds,
  findPendingOrganizationInvitation,
  revertPendingInvitationGrants,
  sendInvitationEmail,
} from '@/lib/invitations/send'
import { captureServerEvent } from '@/lib/posthog/server'
import {
  getEffectiveWorkspacePermission,
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
import { isScimDeploymentEnabled } from '@/ee/scim/lib/entitlement'
import {
  assertInviteeNotScimManaged,
  scimManagedUserPredicate,
} from '@/ee/scim/lib/managed-membership'

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
  /** The platform admin to attribute audit entries to; inviter still authorizes product access. */
  auditActor?: { id: string | null; name: string; email: string | null }
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

async function ensureExistingMemberOrganizationRole({
  context,
  organizationId,
  memberId,
  userId,
  currentRole,
  requestedRole,
  email,
  request,
}: {
  context: WorkspaceInvitationContext
  organizationId: string
  memberId: string
  userId: string
  currentRole: string
  requestedRole: 'admin' | 'member'
  email: string
  request?: NextRequest
}): Promise<{ role: string; updated: boolean }> {
  if (requestedRole !== 'admin' || isOrgAdminRole(currentRole)) {
    return { role: currentRole, updated: false }
  }

  const updated = await db.transaction(async (tx) => {
    await acquireOrganizationUserMutationLocks(tx, {
      userId,
      organizationIds: [organizationId],
    })
    const [actorMembership] = await tx
      .select({ role: member.role })
      .from(member)
      .where(and(eq(member.organizationId, organizationId), eq(member.userId, context.inviterId)))
      .for('update')
      .limit(1)
    const [targetMembership] = await tx
      .select({ role: member.role })
      .from(member)
      .where(
        and(
          eq(member.id, memberId),
          eq(member.organizationId, organizationId),
          eq(member.userId, userId)
        )
      )
      .for('update')
      .limit(1)
    if (!actorMembership || !isOrgAdminRole(actorMembership.role) || !targetMembership) {
      throw new WorkspaceInvitationError({
        message: 'Organization membership changed. Refresh and try again.',
        status: 409,
        email,
      })
    }
    if (isOrgAdminRole(targetMembership.role)) return false
    await tx.update(member).set({ role: 'admin' }).where(eq(member.id, memberId))
    return true
  })

  if (updated) {
    recordAudit({
      actorId: context.auditActor ? context.auditActor.id : context.inviterId,
      actorName: context.auditActor ? context.auditActor.name : context.inviterName,
      actorEmail: context.auditActor ? context.auditActor.email : context.inviterEmail,
      action: AuditAction.ORG_MEMBER_ROLE_CHANGED,
      resourceType: AuditResourceType.ORGANIZATION,
      resourceId: organizationId,
      resourceName: email,
      description: `Promoted ${email} to organization admin during invitation reconciliation`,
      metadata: { targetUserId: userId, memberId, previousRole: currentRole, newRole: 'admin' },
      request,
    })
  }
  return { role: 'admin', updated }
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
  auditActor,
}: {
  workspaceIds: string[]
  inviterId: string
  inviterName: string
  inviterEmail?: string | null
  auditActor?: { id: string | null; name: string; email: string | null }
}): Promise<WorkspaceInvitationContext> {
  const uniqueWorkspaceIds = [...new Set(workspaceIds)]
  if (uniqueWorkspaceIds.length === 0) {
    throw new WorkspaceInvitationError({ message: 'Select at least one workspace', status: 400 })
  }

  const targets: WorkspaceInvitationTarget[] = []
  for (const workspaceId of uniqueWorkspaceIds) {
    const isAdmin = await hasWorkspaceAdminAccess(inviterId, workspaceId)
    if (!isAdmin) {
      throw new WorkspaceInvitationError({
        message: 'You need admin permissions to invite users',
        status: 403,
      })
    }

    /**
     * permission-group-enforced: invitations.send — after the admin check, not
     * before it. The refusal names an organization setting, so answering it to
     * someone with no admin reach into `workspaceId` would tell a bystander in
     * the same organization how another workspace's group is configured. The
     * role check is also the cheaper of the two and names the remedy the caller
     * can actually act on.
     */
    await validateInvitationsAllowed(inviterId, workspaceId)

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

  return { inviterId, inviterName, inviterEmail, targets, organizationId, auditActor }
}

/**
 * External collaborators hold workspace access without consuming a seat, so
 * the economics only work when the invitee already pays Sim somewhere else —
 * their own Pro/Max plan, or an organization that seats them. Admitting a free
 * account as external would be unmetered platform access nobody pays for, so
 * they must be invited as a Member or Admin instead.
 */
async function inviteeCanBeExternal(userId: string | undefined): Promise<boolean> {
  /**
   * The requirement exists because an external collaborator consumes no seat, so
   * somebody else must be paying for them. With billing disabled there are no
   * seats and no subscriptions at all — every account resolves as `free` — so
   * enforcing it would leave a self-hosted deployment no way to grant
   * workspace-only access without an organization join and a workspace sweep.
   */
  if (!isBillingEnabled) return true
  if (!userId) return false
  return (await getInvitePlanCategoryForUser(userId)) !== 'free'
}

async function validateLockedWorkspaceInvitationContext({
  tx,
  context,
  workspaceIds,
  organizationId,
  existingUserId,
  observedInviteeOrganizationId,
  requiresOrganizationAdmin,
  requiresSeatReservation,
  inviteeEmail,
}: {
  tx: DbOrTx
  context: WorkspaceInvitationContext
  workspaceIds: string[]
  organizationId: string | null
  existingUserId?: string
  observedInviteeOrganizationId: string | null
  requiresOrganizationAdmin: boolean
  requiresSeatReservation: boolean
  inviteeEmail: string
}): Promise<void> {
  /**
   * Sending already holds the invitation/workspace advisory locks. Take the
   * same organization → user → membership fence used by direct grants and
   * organization transfers before re-reading any decision that could have
   * gone stale.
   */
  if (existingUserId) {
    await acquireOrganizationUserMutationLocks(tx, {
      userId: existingUserId,
      organizationIds: organizationId ? [organizationId] : [],
    })
  } else if (organizationId) {
    await acquireOrganizationMutationLock(tx, organizationId)
  }

  if (organizationId !== context.organizationId) {
    throw new WorkspaceInvitationError({
      message: 'A selected workspace changed organizations. Review the selection and try again.',
      status: 409,
    })
  }

  if (organizationId) {
    await tx
      .select({ id: member.id, role: member.role })
      .from(member)
      .where(and(eq(member.userId, context.inviterId), eq(member.organizationId, organizationId)))
      .for('update')
  }

  for (const workspaceId of [...new Set(workspaceIds)].sort()) {
    const workspaceDetails = await getWorkspaceWithOwner(workspaceId, {
      executor: tx,
      forUpdate: true,
    })
    if (!workspaceDetails || workspaceDetails.organizationId !== organizationId) {
      throw new WorkspaceInvitationError({
        message: 'A selected workspace changed organizations. Review the selection and try again.',
        status: 409,
      })
    }

    /**
     * Lock both possible authorization rows before resolving effective access.
     * The explicit permission protects direct workspace admin standing; the
     * exact member row protects inherited organization-admin standing from a
     * concurrent role update that does not share invitation advisory locks.
     */
    await tx
      .select({ id: permissions.id })
      .from(permissions)
      .where(
        and(
          eq(permissions.entityType, 'workspace'),
          eq(permissions.entityId, workspaceId),
          eq(permissions.userId, context.inviterId)
        )
      )
      .for('update')
    if (
      (await getEffectiveWorkspacePermission(context.inviterId, workspaceDetails, tx)) !== 'admin'
    ) {
      throw new WorkspaceInvitationError({
        message: 'Your workspace permissions changed. Review the selection and try again.',
        status: 409,
      })
    }
  }

  if (requiresOrganizationAdmin) {
    const inviterMembership = await getUserOrganization(context.inviterId, tx)
    if (
      !organizationId ||
      inviterMembership?.organizationId !== organizationId ||
      !isOrgAdminRole(inviterMembership.role)
    ) {
      throw new WorkspaceInvitationError({
        message: 'Your organization role changed. Review the invitation and try again.',
        status: 409,
      })
    }
  }

  if (
    organizationId &&
    requiresSeatReservation &&
    !(await findPendingOrganizationInvitation(tx, organizationId, inviteeEmail))
  ) {
    const seatValidation = await validateSeatAvailability(organizationId, 1, { executor: tx })
    if (!seatValidation.canInvite) {
      throw new WorkspaceInvitationError({
        message: seatValidation.reason || 'No available seats for this organization.',
        status: 400,
        email: inviteeEmail,
      })
    }
  }

  if (existingUserId) {
    const currentInviteeMembership = await getUserOrganization(existingUserId, tx)
    if ((currentInviteeMembership?.organizationId ?? null) !== observedInviteeOrganizationId) {
      throw new WorkspaceInvitationError({
        message: 'The invitee changed organizations. Review the invitation and try again.',
        status: 409,
      })
    }

    const [existingPermission] = await tx
      .select({ id: permissions.id })
      .from(permissions)
      .where(
        and(
          eq(permissions.entityType, 'workspace'),
          eq(permissions.userId, existingUserId),
          inArray(permissions.entityId, workspaceIds)
        )
      )
      .for('update')
      .limit(1)
    if (existingPermission) {
      throw new WorkspaceInvitationError({
        message: 'The invitee already gained access. Refresh and try again.',
        status: 409,
      })
    }
  }
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
  rejectCrossOrganization = false,
  existingAccessPolicy = 'preserve',
  sourceOperationId,
  auditOperationId,
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
  /** Admin flows use this to avoid silently changing an internal invite into external access. */
  rejectCrossOrganization?: boolean
  /** Provisioning may explicitly ensure requested minimum role/access; ordinary invites preserve it. */
  existingAccessPolicy?: 'preserve' | 'ensure-at-least'
  /** Correlates durable direct-grant notification delivery with a parent operation. */
  sourceOperationId?: string
  /** Makes invitation/direct-grant audits idempotent for durable callers. */
  auditOperationId?: string
  request?: NextRequest
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
    .select({
      id: user.id,
      scimManaged:
        organizationId && isScimDeploymentEnabled()
          ? scimManagedUserPredicate(organizationId, user.id)
          : sql<boolean>`false`,
    })
    .from(user)
    .where(sql`lower(${user.email}) = ${normalizedEmail}`)
    .then((rows) => rows[0])

  /**
   * When the organization has made its identity provider the source of truth for
   * membership, a Sim invitation to someone the directory already provisions is
   * redundant at best and reverted at worst. Read as part of the lookup above so
   * the common case costs no extra query.
   */
  if (organizationId) {
    await assertInviteeNotScimManaged({ organizationId, managed: existingUser?.scimManaged })
  }

  const existingMembership = existingUser ? await getUserOrganization(existingUser.id) : null
  let existingOrganizationRole = existingMembership?.role
  let organizationRoleUpdated = false
  if (
    existingAccessPolicy === 'ensure-at-least' &&
    existingUser &&
    organizationId &&
    existingMembership?.organizationId === organizationId
  ) {
    const ensuredRole = await ensureExistingMemberOrganizationRole({
      context,
      organizationId,
      memberId: existingMembership.memberId,
      userId: existingUser.id,
      currentRole: existingMembership.role,
      requestedRole: membership === 'admin' ? 'admin' : 'member',
      email: normalizedEmail,
      request,
    })
    existingOrganizationRole = ensuredRole.role
    organizationRoleUpdated = ensuredRole.updated
  }

  let pendingTargets = context.targets
  if (existingUser) {
    const accessibleRows = await db
      .select({ workspaceId: permissions.entityId, permission: permissions.permissionType })
      .from(permissions)
      .where(
        and(
          eq(permissions.entityType, 'workspace'),
          eq(permissions.userId, existingUser.id),
          inArray(permissions.entityId, allWorkspaceIds)
        )
      )
    const accessibleWorkspaceIds = new Set(
      accessibleRows
        .filter(
          (row) =>
            existingAccessPolicy === 'preserve' ||
            isOrgAdminRole(existingOrganizationRole) ||
            permissionSatisfies(row.permission, invitationPermission)
        )
        .map((row) => row.workspaceId)
    )

    /**
     * Ordinary invites preserve existing permissions, while trusted durable
     * provisioning/Admin operations may explicitly ensure the requested minimum.
     * Stronger access is always preserved.
     */
    pendingTargets = context.targets.filter(
      (target) => !accessibleWorkspaceIds.has(target.workspaceId)
    )
    if (pendingTargets.length === 0) {
      if (
        existingAccessPolicy === 'ensure-at-least' &&
        organizationId &&
        existingMembership?.organizationId === organizationId
      ) {
        return {
          id: existingUser.id,
          email: normalizedEmail,
          workspaceIds: [],
          permission: invitationPermission,
          membershipIntent: 'internal',
          instantAdd: true,
          outcome: organizationRoleUpdated ? 'updated' : 'unchanged',
        }
      }
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
      let outcome: DirectGrantOutcome['outcome'] = organizationRoleUpdated ? 'updated' : 'unchanged'
      for (const target of pendingTargets) {
        let directGrant: DirectGrantOutcome
        try {
          directGrant = await grantWorkspaceAccessDirectly({
            userId: existingUser.id,
            email: normalizedEmail,
            workspaceId: target.workspaceId,
            workspaceName: target.workspaceDetails.name,
            permission: invitationPermission,
            organizationId,
            actorId: context.inviterId,
            actorName: context.inviterName,
            actorEmail: context.inviterEmail,
            auditActor: context.auditActor,
            request,
            existingPermissionPolicy: existingAccessPolicy,
            sourceOperationId,
            auditOperationId,
          })
        } catch (error) {
          if (error instanceof DirectGrantContextChangedError) {
            throw new WorkspaceInvitationError({
              message:
                'Workspace access or organization membership changed. Refresh and try again.',
              status: 409,
              email: normalizedEmail,
            })
          }
          throw error
        }
        if (directGrant.outcome === 'added') outcome = 'added'
        else if (directGrant.outcome === 'updated' && outcome === 'unchanged') outcome = 'updated'
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
  if (forcedExternal && rejectCrossOrganization) {
    throw new WorkspaceInvitationError({
      message: `${normalizedEmail} already belongs to another organization and cannot be invited as an internal member`,
      status: 409,
      email: normalizedEmail,
    })
  }

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

  /**
   * Granting organization Admin is an organization-level act: an org admin holds
   * admin on every workspace the org owns and can manage members, roles, and
   * billing. Workspace admin authority must not escalate into it, so the inviter
   * has to already hold it. Checked here rather than in the modal because the
   * modal is only the UI — the batch endpoint is reachable directly.
   */
  if (membershipIntent === 'internal' && membership === 'admin') {
    if (!organizationId || !(await isOrganizationOwnerOrAdmin(context.inviterId, organizationId))) {
      throw new WorkspaceInvitationError({
        message:
          'Only an organization owner or admin can invite someone as an organization admin. Invite them as a Member instead.',
        status: 403,
        email: normalizedEmail,
      })
    }
  }

  const role: 'admin' | 'member' =
    membershipIntent === 'internal' && membership === 'admin' ? 'admin' : 'member'

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
      validateLockedContext: ({ tx, organizationId: lockedOrganizationId, workspaceIds }) =>
        validateLockedWorkspaceInvitationContext({
          tx,
          context,
          workspaceIds,
          organizationId: lockedOrganizationId,
          existingUserId: existingUser?.id,
          observedInviteeOrganizationId: existingMembership?.organizationId ?? null,
          requiresOrganizationAdmin: membershipIntent === 'internal' && membership === 'admin',
          requiresSeatReservation:
            membershipIntent === 'internal' && context.targets[0].invitePolicy.requiresSeat,
          inviteeEmail: normalizedEmail,
        }),
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
    let reverted: boolean
    if (invitationRecord.created) {
      reverted = await cancelPendingInvitation(invitationRecord.invitationId, {
        expectedUpdatedAt: invitationRecord.mutationUpdatedAt,
        expectedOrganizationId: invitationRecord.mutationOrganizationId,
      })
    } else {
      reverted = await revertPendingInvitationGrants({
        invitationId: invitationRecord.invitationId,
        workspaceIds: invitationRecord.addedWorkspaceIds,
        expectedUpdatedAt: invitationRecord.mutationUpdatedAt,
        expectedOrganizationId: invitationRecord.mutationOrganizationId,
      })
    }
    if (!reverted) {
      throw new WorkspaceInvitationError({
        message:
          'The email failed after the invitation changed concurrently. Retry to reconcile and deliver the current invitation.',
        status: 409,
        email: normalizedEmail,
      })
    }
    throw new WorkspaceInvitationError({
      message: emailResult.error || 'Failed to send invitation email',
      status: 502,
      email: normalizedEmail,
    })
  }

  for (const target of newTargets) {
    const audit = {
      workspaceId: target.workspaceId,
      actorId: context.auditActor ? context.auditActor.id : context.inviterId,
      actorName: context.auditActor ? context.auditActor.name : context.inviterName,
      actorEmail: context.auditActor ? context.auditActor.email : context.inviterEmail,
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
    } as const
    if (auditOperationId) {
      await recordAuditOnce(`${auditOperationId}:workspace-invitation:${target.workspaceId}`, audit)
    } else {
      recordAudit(audit)
    }
  }

  return {
    id: invitationRecord.invitationId,
    email: normalizedEmail,
    workspaceIds: newWorkspaceIds,
    permission: invitationPermission,
    membershipIntent,
  }
}
