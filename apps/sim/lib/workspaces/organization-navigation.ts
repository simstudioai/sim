import type { WorkspaceHostContext } from '@/lib/api/contracts/workspaces'
import { organizationRoutes } from '@/lib/navigation/paths'

/** Returns the workspace's organization destination only when the viewer can enter it. */
export function getWorkspaceOrganizationHref(hostContext: WorkspaceHostContext): string | null {
  return hostContext.hostOrganizationId &&
    hostContext.viewer.isHostOrganizationMember &&
    hostContext.features?.organizationSearch
    ? organizationRoutes(hostContext.hostOrganizationId).root
    : null
}
