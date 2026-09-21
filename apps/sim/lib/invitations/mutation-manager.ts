import { db } from '@sim/db'
import { user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { ForbiddenOperationError } from '@/lib/core/application/forbidden'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { type InvitationWithGrants, revokeInvitationAsAdmin } from '@/lib/invitations/core'
import { InvitationNotPendingError } from '@/lib/invitations/errors'
import {
  prepareInvitationResend,
  revertInvitationResend,
  sendInvitationEmail,
} from '@/lib/invitations/send'
import { WorkspaceInvitationError } from '@/lib/invitations/workspace-invitations'

const logger = createLogger('InvitationMutationManager')

export async function resendInvitationRecord(input: {
  invitation: InvitationWithGrants
  actorUserId: string
  assertedOrganizationId?: string
}) {
  const inv = input.invitation
  if (inv.status !== 'pending' || inv.expiresAt.getTime() <= Date.now())
    throw new InvitationNotPendingError('resend')
  const [actor] = await db
    .select({ name: user.name, email: user.email })
    .from(user)
    .where(eq(user.id, input.actorUserId))
    .limit(1)
  if (!actor) throw new OrchestrationError('not_found', 'Authenticated user not found')
  const resend = await prepareInvitationResend({
    invitationId: inv.id,
    currentToken: inv.token,
    expectedOrganizationId: input.assertedOrganizationId,
    expectedUpdatedAt: inv.updatedAt,
    actorUserId: input.actorUserId,
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
  }).catch((error: unknown) => {
    logger.error('Invitation resend delivery failed', { invitationId: inv.id, error })
    return { success: false }
  })
  if (!delivered.success) {
    const reverted = await revertInvitationResend(resend)
    throw new WorkspaceInvitationError({
      status: reverted ? 502 : 409,
      message: reverted
        ? 'Failed to send invitation email. Please try again.'
        : 'The invitation changed while delivery failed. Refresh before resending.',
    })
  }
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
    throw new InvitationNotPendingError('revoke')
  }
  return result
}
