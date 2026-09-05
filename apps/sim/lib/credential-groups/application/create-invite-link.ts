import { AuditAction, AuditResourceType } from '@sim/audit'
import { resolvePrincipalSubjectUserId } from '@sim/auth/principal'
import { isValidEmailSyntax, normalizeEmail } from '@sim/utils/string'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { credentialGroupDelegationPolicy } from '@/lib/credential-groups/application/authorization'
import {
  requireCredentialGroupsAvailable,
  resolveWorkspaceAccountsContext,
} from '@/lib/credential-groups/application/context'
import { credentialGroupOperations } from '@/lib/credential-groups/application/operations'
import {
  CredentialGroupEnrollmentError,
  createCredentialGroupInvitationLink,
} from '@/lib/credential-groups/enrollments'

export interface CreateCredentialGroupInviteLinkInput {
  workspaceId: string
  email: string
}

/** Issues a fresh bearer invitation link without delivering an email. */
export const createCredentialGroupInviteLink = defineAuthorizedWorkspaceUseCase({
  operation: credentialGroupOperations.createInviteLink,
  resolveContext: ({ input }: { input: CreateCredentialGroupInviteLinkInput }) =>
    resolveWorkspaceAccountsContext(input.workspaceId),
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

    try {
      return await createCredentialGroupInvitationLink(
        context.workspaceId,
        context.credentialGroupId,
        // Attribution, not authority: the delegation's admin-scoped Credential Group
        // grant is what permits this. An actorless run records no issuer.
        resolvePrincipalSubjectUserId(principal),
        email
      )
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
  projectAudit: ({ context, result }) => ({
    action: AuditAction.CREDENTIAL_GROUP_UPDATED,
    resourceType: AuditResourceType.CREDENTIAL_GROUP,
    resourceId: context.credentialGroupId,
    resourceName: context.name,
    description: `Generated an invitation link for ${result.enrollment.email}`,
    metadata: {
      email: result.enrollment.email,
      enrollmentId: result.enrollment.id,
    },
  }),
})
