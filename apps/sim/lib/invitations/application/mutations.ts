import { AuditAction, AuditResourceType } from '@sim/audit'
import { recordProjectedUseCaseAuditEntries } from '@/lib/core/application/authorized-workspace-use-case'
import type { OperationUseCase } from '@/lib/core/application/operation'
import { runWithOutboundOrganization } from '@/lib/core/network/context.server'
import {
  authorizeInvitationMutation,
  type InvitationMutationInput,
} from '@/lib/invitations/application/authorize-mutation'
import { invitationOperations } from '@/lib/invitations/application/operations'
import { resendInvitationRecord, revokeInvitationRecord } from '@/lib/invitations/mutation-manager'

export const resendInvitation: OperationUseCase<
  typeof invitationOperations.resend,
  Omit<InvitationMutationInput, 'workspaceId'>,
  Awaited<ReturnType<typeof resendInvitationRecord>>
> = {
  operation: invitationOperations.resend,
  async execute({ principal, input, request }) {
    const { invitation, actorUserId } = await authorizeInvitationMutation(
      principal,
      input,
      'resend'
    )
    return runWithOutboundOrganization(invitation.organizationId, async () => {
      const result = await resendInvitationRecord({
        invitation,
        actorUserId,
        assertedOrganizationId: input.assertedOrganizationId,
      })
      recordProjectedUseCaseAuditEntries(
        invitationOperations.resend,
        invitation.grants[0]?.workspaceId ?? null,
        principal,
        request,
        [
          {
            action:
              invitation.kind === 'workspace'
                ? AuditAction.INVITATION_RESENT
                : AuditAction.ORG_INVITATION_RESENT,
            resourceType:
              invitation.kind === 'workspace'
                ? AuditResourceType.WORKSPACE
                : AuditResourceType.ORGANIZATION,
            resourceId:
              invitation.kind === 'workspace'
                ? (invitation.grants[0]?.workspaceId ?? invitation.id)
                : (invitation.organizationId ?? invitation.id),
            description: `Resent ${invitation.kind} invitation to ${invitation.email}`,
            metadata: {
              invitationId: invitation.id,
              targetEmail: invitation.email,
              targetRole: invitation.role,
              kind: invitation.kind,
              membershipIntent: invitation.membershipIntent,
            },
          },
        ],
        invitation.organizationId ?? undefined
      )
      return result
    })
  },
}

export const revokeInvitation: OperationUseCase<
  typeof invitationOperations.revoke,
  InvitationMutationInput,
  Awaited<ReturnType<typeof revokeInvitationRecord>>
> = {
  operation: invitationOperations.revoke,
  async execute({ principal, input, request }) {
    const { actorUserId } = await authorizeInvitationMutation(principal, input, 'revoke')
    const result = await revokeInvitationRecord({ ...input, actorUserId })
    const inv = result.invitation
    const workspaceId = input.workspaceId ?? inv.grants[0]?.workspaceId ?? null
    recordProjectedUseCaseAuditEntries(
      invitationOperations.revoke,
      workspaceId,
      principal,
      request,
      [
        input.workspaceId
          ? {
              action: AuditAction.INVITATION_REVOKED,
              resourceType: AuditResourceType.WORKSPACE,
              resourceId: input.workspaceId,
              description: `Revoked ${inv.email}'s pending invitation to this workspace`,
              metadata: {
                invitationId: inv.id,
                targetEmail: inv.email,
                workspaceId: input.workspaceId,
                invitationCancelled: result.invitationCancelled,
              },
            }
          : {
              action:
                inv.kind === 'workspace'
                  ? AuditAction.INVITATION_REVOKED
                  : AuditAction.ORG_INVITATION_REVOKED,
              resourceType:
                inv.kind === 'workspace'
                  ? AuditResourceType.WORKSPACE
                  : AuditResourceType.ORGANIZATION,
              resourceId:
                inv.kind === 'workspace' ? (workspaceId ?? inv.id) : (inv.organizationId ?? inv.id),
              description: `Cancelled ${inv.kind} invitation for ${inv.email}`,
              metadata: {
                invitationId: inv.id,
                targetEmail: inv.email,
                targetRole: inv.role,
                kind: inv.kind,
              },
            },
      ],
      inv.organizationId ?? undefined
    )
    return result
  },
}
