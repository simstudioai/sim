import { isOutboundRoutingEnabled } from '@/lib/core/network/config.server'
import { runWithOutboundOrganization } from '@/lib/core/network/context.server'
import { outboundFetch } from '@/lib/core/network/outbound-fetch.server'
import { OutboundRoutingError } from '@/lib/core/network/routing'
import { type ResourceOwner, resourceScopeFromOwner } from '@/lib/core/resource-scope'
import { loadWorkspaceApplicationContext } from '@/lib/workspaces/application/context'

/** Establishes routing after resource authorization, reloading current workspace ownership when needed. */
export async function withResourceOutboundScope<T>(
  owner: ResourceOwner,
  run: () => Promise<T>,
  options: { includeArchived?: boolean } = {}
): Promise<T> {
  if (!isOutboundRoutingEnabled()) return run()
  const scope = resourceScopeFromOwner(owner)
  if (scope.kind === 'organization') return runWithOutboundOrganization(scope.organizationId, run)
  const workspace = await loadWorkspaceApplicationContext(scope.workspaceId, options)
  if (!workspace) throw new OutboundRoutingError('MISSING_SCOPE')
  return runWithOutboundOrganization(workspace.workspaceOrganizationId, run)
}

/**
 * `fetch` for a workspace's request, sent through its organization's outbound route. Without a
 * workspace it is a platform request and goes direct.
 */
export function fetchForWorkspace(
  workspaceId: string | undefined,
  input: string,
  init?: RequestInit
): Promise<Response> {
  // egress-direct: no workspace, so a platform request made with Sim's own key
  if (!workspaceId) return fetch(input, init)
  return withResourceOutboundScope({ workspaceId }, () => outboundFetch(input, init))
}
