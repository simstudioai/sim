import type { SelectorKey } from '@/lib/selectors/manifest'
import type { SelectorScope } from '@/lib/selectors/types'

export const selectorKeys = {
  all: ['selectors'] as const,
  scoped: (selectorKey: SelectorKey, scope: SelectorScope | undefined, surfaceId: string) =>
    [
      ...selectorKeys.all,
      selectorKey,
      scope?.kind ?? 'local',
      scope?.kind === 'workflow' ? scope.workflowId : (scope?.workspaceId ?? 'none'),
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
