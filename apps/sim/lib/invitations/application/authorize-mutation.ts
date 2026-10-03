import type { Principal } from '@sim/auth/principal'
import { ForbiddenOperationError } from '@/lib/core/application/forbidden'
import { requireOAuthOperationScope } from '@/lib/core/application/oauth-authorization'
import {
  authorizeOrganizationOperation,
  OrganizationMembershipNotFoundError,
} from '@/lib/core/application/organization-authorization'
import {
  authorizeWorkspaceOperation,
  InsufficientWorkspacePermissionsError,
  NoWorkspaceAccessError,
  PrincipalKindAuthorizationError,
} from '@/lib/core/application/workspace-authorization'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  invitationAuthorityOperations,
  invitationOperations,
} from '@/lib/invitations/application/operations'
import { getInvitationById } from '@/lib/invitations/core'
import { loadWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

export interface InvitationMutationInput {
  invitationId: string
  assertedOrganizationId?: string
  workspaceId?: string
}

/** Public credentials administer an asserted organization; internal sessions retain workspace authority. */
export async function authorizeInvitationMutation(
  principal: Principal,
  input: InvitationMutationInput,
  action: 'resend' | 'revoke'
) {
  const operation = invitationOperations[action]
  if (
    principal.kind !== 'session' &&
    principal.kind !== 'personal_api_key' &&
    principal.kind !== 'oauth_access_token'
  )
    throw new PrincipalKindAuthorizationError(principal.kind, operation.id)
  requireOAuthOperationScope(principal, operation)
  if (principal.kind !== 'session' && !input.assertedOrganizationId)
    throw new Error('Credential invitation administration requires an asserted organization')
  const invitation = await getInvitationById(input.invitationId)
  if (
    !invitation ||
    (input.assertedOrganizationId !== undefined &&
      invitation.organizationId !== input.assertedOrganizationId)
  )
    throw new OrchestrationError('not_found', 'Invitation not found')
  if (invitation.organizationId) {
    try {
      await authorizeOrganizationOperation(principal, invitationAuthorityOperations.organization, {
        organizationId: invitation.organizationId,
      })
      return { invitation, actorUserId: principal.userId }
    } catch (error) {
      if (
        input.assertedOrganizationId !== undefined ||
        !(
          error instanceof OrganizationMembershipNotFoundError ||
          (error instanceof ForbiddenOperationError &&
            error.detailCode === 'ORGANIZATION_ADMIN_REQUIRED')
        )
      )
        throw error
    }
  }
  if (principal.kind !== 'session')
    throw new Error('Workspace invitation authority requires a session')
  const grants = input.workspaceId
    ? invitation.grants.filter((grant) => grant.workspaceId === input.workspaceId)
    : invitation.grants
  let authorized = 0
  for (const grant of grants) {
    const context = await loadWorkspaceApplicationContext(grant.workspaceId, {
      includeArchived: true,
    })
    if (!context) continue
    try {
      await authorizeWorkspaceOperation(principal, invitationAuthorityOperations.workspace, context)
      authorized++
      if (action === 'resend') break
    } catch (error) {
      if (
        !(
          error instanceof InsufficientWorkspacePermissionsError ||
          error instanceof NoWorkspaceAccessError
        )
      )
        throw error
    }
  }
  if (authorized === 0 || (action === 'revoke' && authorized !== grants.length))
    throw new ForbiddenOperationError(
      'INSUFFICIENT_WORKSPACE_ROLE',
      input.workspaceId
        ? 'You need admin permissions on that workspace to revoke its invitation'
        : action === 'revoke' && invitation.grants.length > 1
          ? 'This invitation spans several workspaces. Revoke it from a workspace you administer, or ask an organization admin.'
          : `Only an organization or workspace admin can ${action === 'resend' ? 'resend' : 'cancel'} this invitation`
    )
  return { invitation, actorUserId: principal.userId }
}
