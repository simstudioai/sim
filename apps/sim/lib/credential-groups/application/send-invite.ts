import { AuditAction, AuditResourceType } from '@sim/audit'
import { requirePrincipalSubjectUserId } from '@sim/auth/principal'
import { isValidEmailSyntax, normalizeEmail } from '@sim/utils/string'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { credentialGroupDelegationPolicy } from '@/lib/credential-groups/application/authorization'
import {
  requireCredentialGroupsAvailable,
  resolveCredentialGroupContext,
} from '@/lib/credential-groups/application/context'
import { credentialGroupOperations } from '@/lib/credential-groups/application/operations'
import {
  CredentialGroupEnrollmentError,
  inviteCredentialGroupEnrollment,
  loadCredentialGroupInviterIdentity,
} from '@/lib/credential-groups/enrollments'

export interface SendCredentialGroupInviteInput {
  credentialGroupId: string
  email: string
}

export const sendCredentialGroupInvite = defineAuthorizedWorkspaceUseCase({
  operation: credentialGroupOperations.sendInvite,
  resolveContext: ({ input }: { input: SendCredentialGroupInviteInput }) =>
    resolveCredentialGroupContext(input.credentialGroupId),
  authorizationOptions: { delegation: credentialGroupDelegationPolicy },
  execute: async ({ principal, input, context }) => {
    if (context.status !== 'active') {
      throw new OrchestrationError('conflict', 'Credential group is disabled')
    }
    const email = normalizeEmail(input.email)
    if (!isValidEmailSyntax(email)) {
      throw new OrchestrationError('validation', 'Email must be a valid address')
    }
    await requireCredentialGroupsAvailable(context.workspaceId)

    const userId = requirePrincipalSubjectUserId(principal)
    const inviter = await loadCredentialGroupInviterIdentity(userId)
    const inviterName = inviter?.name?.trim() || inviter?.email
    if (!inviterName) {
      throw new OrchestrationError('conflict', 'Inviting user has no display identity')
    }

    try {
      const enrollment = await inviteCredentialGroupEnrollment(
        context.workspaceId,
        context.credentialGroupId,
        userId,
        inviterName,
        email
      )
      return { enrollment }
    } catch (error) {
      if (error instanceof CredentialGroupEnrollmentError) {
        throw new OrchestrationError(
          error.status === 404 ? 'not_found' : error.status === 409 ? 'conflict' : 'internal',
          error.message
        )
      }
      throw error
    }
  },
  projectAudit: ({ input, context, result }) => ({
    action: AuditAction.CREDENTIAL_GROUP_UPDATED,
    resourceType: AuditResourceType.CREDENTIAL_GROUP,
    resourceId: context.credentialGroupId,
    resourceName: context.name,
    description: `Invited ${result.enrollment.email} to connect accounts`,
    metadata: { email: normalizeEmail(input.email), enrollmentId: result.enrollment.id },
  }),
})
