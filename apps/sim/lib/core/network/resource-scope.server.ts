import { isOutboundRoutingEnabled } from '@/lib/core/network/config.server'
import { runWithOutboundOrganization } from '@/lib/core/network/context.server'
import { OutboundRoutingError } from '@/lib/core/network/routing'
import { type ResourceOwner, resourceScopeFromOwner } from '@/lib/core/resource-scope'
import { loadActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

/** Establishes routing after resource authorization, reloading current workspace ownership when needed. */
export async function withResourceOutboundScope<T>(
  owner: ResourceOwner,
  run: () => Promise<T>
): Promise<T> {
  if (!isOutboundRoutingEnabled()) return run()
  const scope = resourceScopeFromOwner(owner)
  if (scope.kind === 'organization') return runWithOutboundOrganization(scope.organizationId, run)
  const workspace = await loadActiveWorkspaceApplicationContext(scope.workspaceId)
  if (!workspace) throw new OutboundRoutingError('MISSING_SCOPE')
  return runWithOutboundOrganization(workspace.workspaceOrganizationId, run)
}
