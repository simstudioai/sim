import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { foldedEmail, member, user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { isOrgAdminRole } from '@sim/platform-authz/workspace'
import { normalizeEmail } from '@sim/utils/string'
import { and, eq } from 'drizzle-orm'
import { isOrganizationOwnerOrAdmin } from '@/lib/billing/core/organization'
import { resolveOrganizationPlan } from '@/lib/billing/core/subscription'
import {
  acquireOrganizationMutationLock,
  acquireOrganizationUserMutationLocks,
  getUserOrganization,
} from '@/lib/billing/organizations/membership'
import { validateSeatAvailability } from '@/lib/billing/validation/seat-management'
import { isBillingEnabled } from '@/lib/core/config/env-flags'
import type { OrchestrationRequestContext } from '@/lib/core/orchestration/types'
import {
  cancelPendingInvitation,
  createPendingInvitation,
  findPendingOrganizationInvitation,
  sendInvitationEmail,
} from '@/lib/invitations/send'
import {
  WorkspaceInvitationError,
  type WorkspaceInvitationResult,
} from '@/lib/invitations/workspace-invitations'
import { quickValidateEmail } from '@/lib/messaging/email/validation'
import { validateInvitationsAllowed } from '@/ee/access-control/utils/permission-check'

const logger = createLogger('OrganizationInvitations')

export interface OrganizationInvitationContext {
  organizationId: string
  inviterId: string
  inviterName: string
  inviterEmail: string | null
}

/** Authorizes an organization invitation independently of workspace membership. */
export async function prepareOrganizationInvitationContext(
  context: OrganizationInvitationContext
): Promise<OrganizationInvitationContext> {
  if (!(await isOrganizationOwnerOrAdmin(context.inviterId, context.organizationId))) {
    throw new WorkspaceInvitationError({
      message: 'Only organization owners and admins can invite members.',
      status: 403,
    })
  }
  await validateInvitationsAllowed(context.inviterId, { organizationId: context.organizationId })
  if (
    isBillingEnabled &&
    !(await resolveOrganizationPlan(context.organizationId, { onError: 'throw' }))
  ) {
    throw new WorkspaceInvitationError({
      message: 'Your organization needs an active paid plan to invite members.',
      status: 403,
      upgradeRequired: true,
    })
  }
  return context
}

/** Sends a membership invitation without adding workspace grants. */
export async function createOrganizationInvitation({
  context,
  email,
  role,
  request,
}: {
  context: OrganizationInvitationContext
  email: string
  role: 'member' | 'admin'
  request?: OrchestrationRequestContext
}): Promise<WorkspaceInvitationResult> {
  const normalizedEmail = normalizeEmail(email)
  const validation = quickValidateEmail(normalizedEmail)
  if (!validation.isValid) {
    throw new WorkspaceInvitationError({
      message: validation.reason ?? 'Invalid email address',
      status: 400,
      email: normalizedEmail,
    })
  }
  const { organizationId } = context
  const [invitee] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(foldedEmail(user.email), normalizedEmail))
    .limit(1)
  const observedMembership = invitee ? await getUserOrganization(invitee.id) : null
  if (observedMembership) {
    throw new WorkspaceInvitationError({
      message:
        observedMembership.organizationId === organizationId
          ? `${normalizedEmail} is already a member of this organization.`
          : `${normalizedEmail} already belongs to another organization and must leave it before joining.`,
      status: 409,
      email: normalizedEmail,
    })
  }
  const pending = await createPendingInvitation({
    kind: 'organization',
    organizationId,
    inviterId: context.inviterId,
    email: normalizedEmail,
    membershipIntent: 'internal',
    role,
    grants: [],
    validateLockedContext: async ({ tx, organizationId: lockedOrganizationId }) => {
      if (lockedOrganizationId !== organizationId) {
        throw new WorkspaceInvitationError({
          message: 'Invitation scope changed. Refresh and try again.',
          status: 409,
        })
      }
      if (invitee) {
        await acquireOrganizationUserMutationLocks(tx, {
          userId: invitee.id,
          organizationIds: [organizationId],
        })
      } else {
        await acquireOrganizationMutationLock(tx, organizationId)
      }
      const [authority] = await tx
        .select({ role: member.role })
        .from(member)
        .where(and(eq(member.organizationId, organizationId), eq(member.userId, context.inviterId)))
        .for('update')
        .limit(1)
      if (!isOrgAdminRole(authority?.role)) {
        throw new WorkspaceInvitationError({
          message: 'Your organization role changed. Refresh and try again.',
          status: 409,
        })
      }
      if (invitee && (await getUserOrganization(invitee.id, tx))) {
        throw new WorkspaceInvitationError({
          message: 'The invitee joined an organization. Refresh and try again.',
          status: 409,
          email: normalizedEmail,
        })
      }
      if (await findPendingOrganizationInvitation(tx, organizationId, normalizedEmail)) {
        throw new WorkspaceInvitationError({
          message: `${normalizedEmail} already has a pending invitation. Resend it from Members.`,
          status: 409,
          email: normalizedEmail,
        })
      }
      const capacity = await validateSeatAvailability(organizationId, 1, { executor: tx })
      if (!capacity.canInvite) {
        throw new WorkspaceInvitationError({
          message: capacity.reason ?? 'No available seats for this organization.',
          status: 400,
          email: normalizedEmail,
        })
      }
    },
  })
  const delivery = await sendInvitationEmail({
    invitationId: pending.invitationId,
    token: pending.token,
    kind: 'organization',
    email: normalizedEmail,
    inviterName: context.inviterName,
    organizationId,
    organizationRole: role,
    grants: [],
  }).catch((error: unknown) => {
    logger.error('Organization invitation delivery failed', {
      invitationId: pending.invitationId,
      error,
    })
    return { success: false }
  })
  if (!delivery.success) {
    const cancelled = await cancelPendingInvitation(pending.invitationId, {
      expectedUpdatedAt: pending.mutationUpdatedAt,
      expectedOrganizationId: pending.mutationOrganizationId,
    })
    throw new WorkspaceInvitationError({
      message: cancelled
        ? 'The invitation email could not be delivered. Please try again.'
        : 'The invitation changed while delivery failed. Review it in Members before retrying.',
      status: cancelled ? 502 : 409,
      email: normalizedEmail,
    })
  }
  recordAudit({
    actorId: context.inviterId,
    actorName: context.inviterName,
    actorEmail: context.inviterEmail,
    action: AuditAction.MEMBER_INVITED,
    resourceType: AuditResourceType.ORGANIZATION,
    resourceId: organizationId,
    resourceName: normalizedEmail,
    description: `Invited ${normalizedEmail} as an organization ${role}`,
    metadata: {
      organizationId,
      invitationId: pending.invitationId,
      targetEmail: normalizedEmail,
      organizationRole: role,
    },
    request,
  })
  return {
    id: pending.invitationId,
    email: normalizedEmail,
    workspaceIds: [],
    permission: 'read',
    membershipIntent: 'internal',
  }
}
