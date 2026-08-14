import type { WorkspaceHostContext } from '@/lib/api/contracts/workspaces'
import { isCredentialGroupsAvailable } from '@/lib/credential-groups/availability'
import { getWorkspaceHostContextForViewer } from '@/lib/workspaces/host-context'

export class CredentialGroupAccessError extends Error {
  constructor(
    message: string,
    readonly status: 403 | 404
  ) {
    super(message)
    this.name = 'CredentialGroupAccessError'
  }
}

/** Resolves the workspace entitlement and requires workspace-admin access. */
export async function authorizeCredentialGroupSettings(
  workspaceId: string,
  userId: string
): Promise<WorkspaceHostContext> {
  const hostContext = await getWorkspaceHostContextForViewer(workspaceId, userId)
  if (!hostContext) throw new CredentialGroupAccessError('Workspace not found', 404)
  if (!(await isCredentialGroupsAvailable(hostContext.ownerBilling))) {
    throw new CredentialGroupAccessError('Credential Groups are not available', 404)
  }
  if (hostContext.viewer.permission !== 'admin') {
    throw new CredentialGroupAccessError('Workspace admin access is required', 403)
  }
  return hostContext
}
