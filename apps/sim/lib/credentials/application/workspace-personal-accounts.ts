import type { Principal } from '@sim/auth/principal'
import type { WorkspaceAuthorizationContext } from '@/lib/core/application'
import { requireOrganizationMembership } from '@/lib/core/application/organization-authorization'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { loadScopedAccountsCredentialListContext } from '@/lib/credential-groups/credentials'
import { requireOrganizationAccountsSetup } from '@/lib/credential-groups/organization-setup'
import { isScopedCredentialGroupsAvailable } from '@/lib/credential-groups/scoped-availability'

/**
 * Resolves personal enrollment after the calling operation authorizes its workspace.
 * Connecting one's own account does not grant the workspace access to it from workflows.
 */
export async function requireWorkspacePersonalAccounts(
  principal: Principal,
  context: WorkspaceAuthorizationContext
) {
  const organizationId = context.workspaceOrganizationId
  if (!organizationId) {
    throw new OrchestrationError('forbidden', 'This workspace does not belong to an organization')
  }
  await requireOrganizationMembership(principal, organizationId, 'member', 'integrations.manage')
  if (!(await isScopedCredentialGroupsAvailable({ kind: 'organization', organizationId }))) {
    throw new OrchestrationError('not_found', 'Organization connected accounts are not available')
  }
  const group = await loadScopedAccountsCredentialListContext({
    kind: 'organization',
    organizationId,
  })
  if (!group) {
    throw new OrchestrationError(
      'not_found',
      'Ask an organization admin to set up Connected accounts in organization settings'
    )
  }
  if (group.status !== 'active') {
    throw new OrchestrationError('forbidden', 'Connected accounts is disabled in this organization')
  }
  await requireOrganizationAccountsSetup(organizationId, group.credentialGroupId)
  return { ...group, organizationId }
}
