import { getWorkspaceOwnerSubscriptionAccess } from '@/lib/billing/core/workspace-access'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { CredentialGroupApplicationContext } from '@/lib/credential-groups/application/authorization'
import {
  isCredentialGroupsAvailable,
  resolveCredentialGroupsAvailability,
} from '@/lib/credential-groups/availability'
import {
  loadCredentialGroupCredentialListContext,
  loadWorkspaceAccountsCredentialListContext,
} from '@/lib/credential-groups/credentials'
import { loadActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

export async function requireCredentialGroupsAvailable(workspaceId: string): Promise<void> {
  const ownerBilling = await getWorkspaceOwnerSubscriptionAccess(workspaceId)
  const availability = await resolveCredentialGroupsAvailability({
    organizationId: ownerBilling.organizationId,
    ownerBilling,
  })
  if (!availability.available) {
    const message =
      availability.reason === 'enterprise_plan_required'
        ? 'Credential Groups are not available. Enterprise plan required.'
        : 'Credential Groups are not available'
    throw new OrchestrationError('forbidden', message)
  }
}

export async function requireCredentialGroupSettingsAvailable(workspaceId: string): Promise<void> {
  const ownerBilling = await getWorkspaceOwnerSubscriptionAccess(workspaceId)
  if (
    !(await isCredentialGroupsAvailable({
      organizationId: ownerBilling.organizationId,
      ownerBilling,
    }))
  ) {
    throw new OrchestrationError('not_found', 'Credential Groups are not available')
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

export async function resolveWorkspaceAccountsContext(
  workspaceId: string
): Promise<CredentialGroupApplicationContext> {
  const workspace = await resolveCredentialGroupWorkspaceContext(workspaceId)
  const group = await loadWorkspaceAccountsCredentialListContext(workspaceId)
  if (!group) throw new OrchestrationError('not_found', 'Connected accounts are not configured')
  return { ...workspace, ...group }
}

export async function resolveCredentialGroupSettingsContext(
  credentialGroupId: string,
  assertedWorkspaceId: string
): Promise<CredentialGroupApplicationContext> {
  const context = await resolveCredentialGroupContext(credentialGroupId)
  if (context.workspaceId !== assertedWorkspaceId) {
    throw new OrchestrationError('not_found', 'Credential group not found')
  }
  return context
}
