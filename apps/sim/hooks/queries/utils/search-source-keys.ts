import { type ResourceScope, resourceScopeKey } from '@/lib/core/resource-scope'

export const searchSourceKeys = {
  all: ['search-sources'] as const,
  lists: () => [...searchSourceKeys.all, 'list'] as const,
  pages: (
    scope: string | ResourceScope | undefined,
    filters: {
      search: string
      connectorType?: string
      excludeConnectorType?: string
    }
  ) => [...searchSourceKeys.list(scope), 'pages', filters] as const,
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
