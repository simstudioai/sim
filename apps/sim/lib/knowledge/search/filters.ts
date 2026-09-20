import { OrchestrationError } from '@/lib/core/orchestration/types'

/** Document constraints shared by Search and Assistant, applied before ranking. */
export interface WorkspaceSearchFilters {
  source?: string
  modifiedAfter?: string
  modifiedBefore?: string
  documentIds?: string[]
}

/** A tool may refine the user's selected scope but cannot broaden it. */
export function intersectWorkspaceSearchFilters(
  requested: WorkspaceSearchFilters = {},
  scope: WorkspaceSearchFilters = {}
): WorkspaceSearchFilters {
  if (scope.source && requested.source && scope.source !== requested.source) {
    throw new OrchestrationError('validation', 'The requested source is outside this search')
  }
  const documentIds = scope.documentIds
    ? requested.documentIds
      ? requested.documentIds.filter((id) => scope.documentIds!.includes(id))
      : scope.documentIds
    : requested.documentIds
  if (documentIds?.length === 0) {
    throw new OrchestrationError('validation', 'The requested document is outside this search')
  }
  const modifiedAfter = [requested.modifiedAfter, scope.modifiedAfter]
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => Date.parse(a) - Date.parse(b))
    .at(-1)
  /** The narrower end of each bound wins, so the intersection can only shrink the window. */
  const modifiedBefore = [requested.modifiedBefore, scope.modifiedBefore]
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => Date.parse(a) - Date.parse(b))
    .at(0)
  if (modifiedAfter && modifiedBefore && Date.parse(modifiedBefore) < Date.parse(modifiedAfter)) {
    throw new OrchestrationError('validation', 'The requested dates are outside this search')
  }
  return {
    ...(scope.source || requested.source ? { source: scope.source ?? requested.source } : {}),
    ...(modifiedAfter ? { modifiedAfter } : {}),
    ...(modifiedBefore ? { modifiedBefore } : {}),
    ...(documentIds ? { documentIds: [...new Set(documentIds)] } : {}),
  }
}
