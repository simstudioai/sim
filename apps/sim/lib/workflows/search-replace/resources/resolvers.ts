import type {
  WorkflowSearchMatch,
  WorkflowSearchReplacementOption,
  WorkflowSearchResourceMeta,
} from '@/lib/workflows/search-replace/types'
import type { SelectorContext } from '@/hooks/selectors/types'

export function stableStringifyWorkflowSearchValue(value: unknown): string {
  if (!value || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringifyWorkflowSearchValue(item)).join(',')}]`
  }

  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringifyWorkflowSearchValue(item)}`)
    .join(',')}}`
}

export function buildWorkflowSearchResourceGroupKey(
  resource: Pick<
    WorkflowSearchResourceMeta,
    'kind' | 'providerId' | 'serviceId' | 'selectorKey' | 'selectorContext'
  >
): string {
  const provider = resource.providerId ?? resource.serviceId ?? ''
  const selectorKey = resource.selectorKey ?? ''
  const selectorContext = resource.selectorContext
    ? stableStringifyWorkflowSearchValue(resource.selectorContext)
    : ''

  return [resource.kind, provider, selectorKey, selectorContext].join(':')
}

export function getWorkflowSearchMatchResourceGroupKey(match: WorkflowSearchMatch): string {
  return (
    match.resource?.resourceGroupKey ??
    buildWorkflowSearchResourceGroupKey({
      kind: match.kind as WorkflowSearchResourceMeta['kind'],
      providerId: match.resource?.providerId,
      serviceId: match.resource?.serviceId,
      selectorKey: match.resource?.selectorKey,
      selectorContext: match.resource?.selectorContext,
    })
  )
}

export function selectorContextMatches(
  left: SelectorContext | undefined,
  right: SelectorContext | undefined
): boolean {
  return (
    stableStringifyWorkflowSearchValue(left ?? {}) ===
    stableStringifyWorkflowSearchValue(right ?? {})
  )
}

export function replacementOptionMatchesResourceMatch(
  option: WorkflowSearchReplacementOption,
  match: WorkflowSearchMatch
): boolean {
  if (option.kind !== match.kind) return false

  const optionGroupKey =
    option.resourceGroupKey ??
    buildWorkflowSearchResourceGroupKey({
      kind: option.kind as WorkflowSearchResourceMeta['kind'],
      providerId: option.providerId,
      serviceId: option.serviceId,
      selectorKey: option.selectorKey,
      selectorContext: option.selectorContext,
    })

  return optionGroupKey === getWorkflowSearchMatchResourceGroupKey(match)
}

export function getWorkflowSearchCompatibleResourceMatches(
  activeMatch: WorkflowSearchMatch | null,
  matches: WorkflowSearchMatch[]
): WorkflowSearchMatch[] {
  if (!activeMatch?.resource) return []
  const activeGroupKey = getWorkflowSearchMatchResourceGroupKey(activeMatch)
  return matches.filter(
    (match) =>
      match.editable &&
      Boolean(match.resource) &&
      getWorkflowSearchMatchResourceGroupKey(match) === activeGroupKey
  )
}

export function workflowSearchMatchMatchesQuery(
  match: WorkflowSearchMatch & { displayLabel?: string },
  query: string,
  caseSensitive = false
): boolean {
  const trimmedQuery = query.trim()
  if (!trimmedQuery) return false
  if (match.kind === 'text') return true

  const normalize = (value: string) => (caseSensitive ? value : value.toLowerCase())
  const searchable =
    match.resource?.kind === 'workflow-reference' || match.resource?.kind === 'environment'
      ? [match.displayLabel, match.rawValue, match.searchText, match.fieldTitle, match.blockName]
      : [match.displayLabel, match.fieldTitle, match.blockName]
  const searchableText = searchable.filter(Boolean).join(' ')

  return normalize(searchableText).includes(normalize(trimmedQuery))
}
