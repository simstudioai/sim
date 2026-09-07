/** Canonical ownership of resources available in a workspace or an organization. */
export type ResourceScope =
  | { kind: 'workspace'; workspaceId: string }
  | { kind: 'organization'; organizationId: string }

export interface ResourceOwner {
  workspaceId?: string | null
  organizationId?: string | null
}

/** Rejects ambiguous or absent ownership instead of inferring a different tenant. */
export function resourceScopeFromOwner(owner: ResourceOwner): ResourceScope {
  const workspaceId = owner.workspaceId
  const organizationId = owner.organizationId
  if (workspaceId && !organizationId) return { kind: 'workspace', workspaceId }
  if (organizationId && !workspaceId) return { kind: 'organization', organizationId }
  throw new Error('Resource requires exactly one workspace or organization owner')
}

export function resourceScopeColumns(scope: ResourceScope) {
  return scope.kind === 'workspace'
    ? { workspaceId: scope.workspaceId, organizationId: null }
    : { workspaceId: null, organizationId: scope.organizationId }
}

export function resourceScopeKey(scope: ResourceScope): string {
  return scope.kind === 'workspace'
    ? `workspace:${scope.workspaceId}`
    : `organization:${scope.organizationId}`
}

export function sameResourceScope(left: ResourceScope, right: ResourceScope): boolean {
  return resourceScopeKey(left) === resourceScopeKey(right)
}

/** Scope fields for application inputs, with the unselected owner omitted. */
export function resourceScopeFields(
  scope: ResourceScope
):
  | { workspaceId: string; organizationId?: undefined }
  | { organizationId: string; workspaceId?: undefined } {
  return scope.kind === 'workspace'
    ? { workspaceId: scope.workspaceId }
    : { organizationId: scope.organizationId }
}
