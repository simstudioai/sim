import { db } from '@sim/db'
import { user } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { getOrganizationSubscription } from '@/lib/billing/core/billing'
import { isEnterprise, isTeam } from '@/lib/billing/plan-helpers'
import { hasUsableSubscriptionStatus } from '@/lib/billing/subscriptions/utils'
import { ForbiddenOperationError } from '@/lib/core/application/forbidden'
import { isBillingEnabled } from '@/lib/core/config/env-flags'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  type InvitationWithGrants,
  resolveInvitationAdmissionOrganizationId,
  revokeInvitationAsAdmin,
} from '@/lib/invitations/core'
import {
  persistInvitationResend,
  prepareInvitationResend,
  sendInvitationEmail,
} from '@/lib/invitations/send'
import { WorkspaceInvitationError } from '@/lib/invitations/workspace-invitations'
import { getWorkspaceWithOwner } from '@/lib/workspaces/permissions/utils'
import { getWorkspaceInvitePolicy } from '@/lib/workspaces/policy'
import { validateInvitationsAllowed } from '@/ee/access-control/utils/permission-check'

export async function resendInvitationRecord(input: {
  invitation: InvitationWithGrants
  actorUserId: string
  assertedOrganizationId?: string
}) {
  const inv = input.invitation
  if (inv.status !== 'pending' || inv.expiresAt.getTime() <= Date.now())
    throw new OrchestrationError(
      'conflict',
      'Can only resend unexpired pending invitations. Create a new invitation after expiration.'
    )
  /** permission-group-enforced: invitations.send — resend rechecks organization admission and every workspace grant. */
  const admissionOrganizationId = await resolveInvitationAdmissionOrganizationId(inv)
  if (admissionOrganizationId)
    await validateInvitationsAllowed(input.actorUserId, { organizationId: admissionOrganizationId })
  for (const grant of inv.grants) {
    await validateInvitationsAllowed(input.actorUserId, { workspaceId: grant.workspaceId })
    const details = await getWorkspaceWithOwner(grant.workspaceId)
    if (!details)
      throw new OrchestrationError(
        'conflict',
        'Invitation references a workspace that no longer exists'
      )
    const policy = await getWorkspaceInvitePolicy(details)
    if (!policy.allowed)
      throw new WorkspaceInvitationError({
        status: 403,
        message: policy.reason ?? 'Invites are no longer allowed on this workspace',
        upgradeRequired: policy.upgradeRequired,
      })
  }
  if (
    isBillingEnabled &&
    inv.kind === 'organization' &&
    inv.grants.length === 0 &&
    inv.organizationId
  ) {
    const subscription = await getOrganizationSubscription(inv.organizationId)
    if (
      !subscription ||
      !hasUsableSubscriptionStatus(subscription.status) ||
      (!isTeam(subscription.plan) && !isEnterprise(subscription.plan))
    )
      throw new WorkspaceInvitationError({
        status: 403,
        message: 'Invites are no longer allowed on this organization',
        upgradeRequired: true,
      })
  }
  const [actor] = await db
    .select({ name: user.name, email: user.email })
    .from(user)
    .where(eq(user.id, input.actorUserId))
    .limit(1)
  if (!actor) throw new OrchestrationError('not_found', 'Authenticated user not found')
  const resend = await prepareInvitationResend({
    invitationId: inv.id,
    currentToken: inv.token,
    rotateToken: true,
  })
  const delivered = await sendInvitationEmail({
    invitationId: inv.id,
    token: resend.tokenForEmail,
    kind: inv.kind,
    email: inv.email,
    inviterName: actor.name || actor.email || 'A user',
    organizationId: inv.organizationId,
    organizationRole: inv.role === 'admin' ? 'admin' : 'member',
    grants: inv.grants.map((grant) => ({
      workspaceId: grant.workspaceId,
      permission: grant.permission,
    })),
  })
  if (!delivered.success)
    throw new WorkspaceInvitationError({
      status: 502,
      message: delivered.error || 'Failed to send invitation email',
    })
  await persistInvitationResend({
    invitationId: inv.id,
    nextToken: resend.nextToken,
    nextExpiresAt: resend.nextExpiresAt,
    expectedOrganizationId: input.assertedOrganizationId,
    expectedUpdatedAt: inv.updatedAt,
    actorUserId: input.actorUserId,
  })
  return {
    id: inv.id,
    organizationId: inv.organizationId,
    email: inv.email,
    role: inv.role,
    kind: inv.kind,
    membershipIntent: inv.membershipIntent,
    status: inv.status,
    createdAt: inv.createdAt,
    expiresAt: resend.nextExpiresAt,
    grants: inv.grants,
  }
}

export async function revokeInvitationRecord(input: {
  invitationId: string
  actorUserId: string
  assertedOrganizationId?: string
  workspaceId?: string
}) {
  const result = await revokeInvitationAsAdmin({
    actorId: input.actorUserId,
    invitationId: input.invitationId,
    organizationId: input.assertedOrganizationId,
    workspaceId: input.workspaceId,
  })
  if (!result.success) {
    if (result.kind === 'not-found')
      throw new OrchestrationError('not_found', 'Invitation not found')
    if (result.kind === 'scoped-forbidden' || result.kind === 'whole-forbidden')
      throw new ForbiddenOperationError(
        input.assertedOrganizationId
          ? 'ORGANIZATION_ADMIN_REQUIRED'
          : 'INSUFFICIENT_WORKSPACE_ROLE',
        'Administrator access is required to revoke this invitation'
      )
    if (result.kind === 'grant-not-found')
      throw new OrchestrationError(
        'validation',
        'Invitation does not grant access to that workspace'
      )
    throw new OrchestrationError('conflict', 'Can only revoke unexpired pending invitations')
  }
  return result
}
