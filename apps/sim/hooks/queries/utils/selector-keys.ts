import type { QueryClient } from '@tanstack/react-query'
import type { SelectorKey } from '@/lib/selectors/manifest'
import type { SelectorScope } from '@/lib/selectors/types'

export const selectorQueryRoots = {
  selectors: ['selectors'],
  workflowSearchReplace: ['workflow-search-replace'],
} as const

export const selectorKeys = {
  all: selectorQueryRoots.selectors,
  scoped: (selectorKey: SelectorKey, scope: SelectorScope | undefined, surfaceId: string) =>
    [
      ...selectorKeys.all,
      selectorKey,
      scope?.kind ?? 'local',
      scope?.kind === 'workflow'
        ? scope.workflowId
        : scope?.kind === 'organization'
          ? scope.organizationId
          : (scope?.workspaceId ?? 'none'),
      scope?.kind === 'workflow' ? (scope.workspaceId ?? 'none') : 'none',
      surfaceId,
    ] as const,
  request: (
    selectorKey: SelectorKey,
    scope: SelectorScope | undefined,
    surfaceId: string,
    requestKind: 'list' | 'detail',
    opaqueRevision: number,
    ordinal?: number
  ) =>
    [
      ...selectorKeys.scoped(selectorKey, scope, surfaceId),
      requestKind,
      opaqueRevision,
      ...(ordinal === undefined ? [] : [ordinal]),
    ] as const,
}

/** Invalidates every client cache that executes or hydrates dynamic selectors. */
export async function invalidateSelectorQueries(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: selectorQueryRoots.selectors }),
    queryClient.invalidateQueries({ queryKey: selectorQueryRoots.workflowSearchReplace }),
  ])
}
