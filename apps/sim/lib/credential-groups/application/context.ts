import { getWorkspaceOwnerSubscriptionAccess } from '@/lib/billing/core/workspace-access'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { CredentialGroupApplicationContext } from '@/lib/credential-groups/application/authorization'
import { isCredentialGroupsAvailable } from '@/lib/credential-groups/availability'
import { loadCredentialGroupCredentialListContext } from '@/lib/credential-groups/credentials'
import { loadActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

export async function requireCredentialGroupsAvailable(workspaceId: string): Promise<void> {
  const ownerBilling = await getWorkspaceOwnerSubscriptionAccess(workspaceId)
  if (!(await isCredentialGroupsAvailable(ownerBilling))) {
    throw new OrchestrationError('forbidden', 'Credential Groups are not available')
  }
}

export async function resolveCredentialGroupWorkspaceContext(workspaceId: string) {
  const workspace = await loadActiveWorkspaceApplicationContext(workspaceId)
  if (!workspace) throw new OrchestrationError('not_found', 'Workspace not found')
  return workspace
}

export async function resolveCredentialGroupContext(
  credentialGroupId: string
): Promise<CredentialGroupApplicationContext> {
  const group = await loadCredentialGroupCredentialListContext(credentialGroupId)
  if (!group) throw new OrchestrationError('not_found', 'Credential group not found')
  return { ...(await resolveCredentialGroupWorkspaceContext(group.workspaceId)), ...group }
}
