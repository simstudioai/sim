import { type ResourceScope, resourceScopeKey } from '@/lib/core/resource-scope'

export const searchSourceKeys = {
  all: ['search-sources'] as const,
  lists: () => [...searchSourceKeys.all, 'list'] as const,
  progress: (scope: ResourceScope | undefined, connectorIds: string[]) =>
    [
      ...searchSourceKeys.all,
      'progress',
      scope ? resourceScopeKey(scope) : '',
      connectorIds,
    ] as const,
  pages: (
    scope: string | ResourceScope | undefined,
    filters: { search: string; mine: boolean; connectorType?: string }
  ) => [...searchSourceKeys.list(scope), 'pages', filters] as const,
  overview: (scope?: string | ResourceScope) =>
    [...searchSourceKeys.list(scope), 'overview'] as const,
  organizationOverview: (organizationId: string) =>
    [...searchSourceKeys.list({ kind: 'organization', organizationId }), 'admin-overview'] as const,
  list: (scope?: string | ResourceScope) =>
    [
      ...searchSourceKeys.lists(),
      typeof scope === 'string'
        ? scope
        : scope?.kind === 'workspace'
          ? scope.workspaceId
          : scope
            ? resourceScopeKey(scope)
            : '',
    ] as const,
}
