import type { SearchResource } from '@/lib/mothership/generated/resources'
import type { MothershipResource } from '@/lib/mothership/resources/types'

/** One persistent Search tab per resource owner; each search updates its retrieval address. */
export function createSearchResource(search: SearchResource): MothershipResource {
  const scope = search.scope
  const scopeId = scope.kind === 'organization' ? scope.organizationId : scope.workspaceId
  return {
    type: 'search',
    id: `search:${scope.kind}:${scopeId}`,
    title: 'Search results',
    ...(scope.kind === 'workspace' ? { workspaceId: scope.workspaceId } : {}),
    search,
  }
}

/** A Search address cannot change the conversation's retrieval owner. */
export function searchResourceMatchesOwner(
  search: SearchResource,
  owner: { organizationId?: string; workspaceId?: string }
): boolean {
  return search.scope.kind === 'organization'
    ? !owner.workspaceId && search.scope.organizationId === owner.organizationId
    : !owner.organizationId && search.scope.workspaceId === owner.workspaceId
}
