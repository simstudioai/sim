import { AuditAction, AuditResourceType } from '@sim/audit'
import { resolvePrincipalSubjectUserId } from '@sim/auth/principal'
import { isValidEmailSyntax, normalizeEmail } from '@sim/utils/string'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  credentialGroupDelegationPolicy,
  requireCredentialGroupWorkflowActor,
} from '@/lib/credential-groups/application/authorization'
import {
  requireCredentialGroupsAvailable,
  resolveWorkspaceAccountsContext,
} from '@/lib/credential-groups/application/context'
import { credentialGroupOperations } from '@/lib/credential-groups/application/operations'
import {
  CredentialGroupEnrollmentError,
  inviteCredentialGroupEnrollment,
  loadCredentialGroupInviterIdentity,
} from '@/lib/credential-groups/enrollments'

export interface SendCredentialGroupInviteInput {
  workspaceId: string
  email: string
}

export const sendCredentialGroupInvite = defineAuthorizedWorkspaceUseCase({
  operation: credentialGroupOperations.sendInvite,
  resolveContext: ({ input }: { input: SendCredentialGroupInviteInput }) =>
    resolveWorkspaceAccountsContext(input.workspaceId),
  authorizationOptions: { delegation: credentialGroupDelegationPolicy },
  authorizeResource({ principal }) {
    requireCredentialGroupWorkflowActor(principal)
  },
  execute: async ({ principal, input, context }) => {
    if (context.status !== 'active') {
      throw new OrchestrationError('conflict', 'Credential group is disabled')
    }
    const email = normalizeEmail(input.email)
    if (!isValidEmailSyntax(email)) {
      throw new OrchestrationError('validation', 'Email must be a valid address')
    }
    await requireCredentialGroupsAvailable(context.workspaceId)

    // Attribution, not authority. An actorless or Slack-triggered run names no
    // inviter rather than borrowing its actor, so the email claims no one invited.
    const userId = resolvePrincipalSubjectUserId(principal)
    const inviter = userId ? await loadCredentialGroupInviterIdentity(userId) : null
    const inviterName = inviter?.name?.trim() || inviter?.email

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
