import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { CredentialGroupApplicationContext } from '@/lib/credential-groups/application/authorization'
import { resolveCredentialGroupWorkspaceContext } from '@/lib/credential-groups/application/context'
import {
  organizationAccountAccessPolicyCodec,
  organizationAccountPolicyAllowsWorkspace,
} from '@/lib/credential-groups/application/workspace-access-policy'
import { loadScopedAccountsCredentialListContext } from '@/lib/credential-groups/credentials'
import { isScopedCredentialGroupsAvailable } from '@/lib/credential-groups/scoped-availability'
import { requireResourcePolicy } from '@/lib/resource-policies/repository'

export interface OrganizationAccountsWorkspaceContext extends CredentialGroupApplicationContext {
  organizationId: string
}

/** Resolves the singleton using the executing workspace's current organization. */
export async function resolveOrganizationAccountsWorkspaceContext(
  workspaceId: string
): Promise<OrganizationAccountsWorkspaceContext> {
  const workspace = await resolveCredentialGroupWorkspaceContext(workspaceId)
  if (!workspace.workspaceOrganizationId) {
    throw new OrchestrationError('forbidden', 'This workspace does not belong to an organization')
  }
  const group = await loadScopedAccountsCredentialListContext({
    kind: 'organization',
    organizationId: workspace.workspaceOrganizationId,
  })
  if (!group)
    throw new OrchestrationError('not_found', 'Organization connected accounts are not configured')
  return { ...group, ...workspace, organizationId: workspace.workspaceOrganizationId }
}

/** Uses live policy and ownership; cached selections and deployment snapshots never grant access. */
export async function requireOrganizationAccountsWorkspaceAccess(context: {
  workspaceId: string
  workspaceOrganizationId: string | null
  organizationId: string
  credentialGroupId: string
}): Promise<void> {
  if (context.organizationId !== context.workspaceOrganizationId) {
    throw new OrchestrationError('forbidden', 'Connected accounts belong to another organization')
  }
  if (
    !(await isScopedCredentialGroupsAvailable({
      kind: 'organization',
      organizationId: context.organizationId,
    }))
  ) {
    throw new OrchestrationError('not_found', 'Organization connected accounts are not available')
  }
  const policy = await requireResourcePolicy({
    organizationId: context.organizationId,
    resourceType: 'credential_group',
    resourceId: context.credentialGroupId,
    codec: organizationAccountAccessPolicyCodec,
  })
  if (!organizationAccountPolicyAllowsWorkspace(policy.document, context.workspaceId)) {
    throw new OrchestrationError(
      'forbidden',
      'An organization admin must allow this workspace to use connected accounts'
    )
  }
}
