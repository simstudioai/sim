import type {
  WorkflowSearchMatch,
  WorkflowSearchMatchKind,
  WorkflowSearchReplacementOption,
  WorkflowSearchResourceMeta,
  WorkflowSearchValuePath,
} from '@/lib/workflows/search-replace/types'
import type { SelectorContext } from '@/hooks/selectors/types'

const OVERLAPPING_MATCH_KIND_PRIORITY: Record<WorkflowSearchMatchKind, number> = {
  text: 0,
  environment: 1,
  'workflow-reference': 2,
  'oauth-credential': 3,
  'knowledge-base': 3,
  'knowledge-document': 3,
  workflow: 3,
  'mcp-server': 3,
  'mcp-tool': 3,
  table: 3,
  file: 3,
  'selector-resource': 3,
}

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

function searchValuePathKey(path: WorkflowSearchValuePath): string {
  return path.map((segment) => `${typeof segment}:${String(segment)}`).join('/')
}

function getRangeMatchScopeKey(match: WorkflowSearchMatch): string | null {
  if (!match.range) return null
  if (match.target.kind !== 'subblock') return null
  return [match.blockId, match.subBlockId, searchValuePathKey(match.valuePath)].join(':')
}

function rangesOverlap(
  left: NonNullable<WorkflowSearchMatch['range']>,
  right: NonNullable<WorkflowSearchMatch['range']>
): boolean {
  return left.start < right.end && right.start < left.end
}

function getRangeLength(match: WorkflowSearchMatch): number {
  return match.range ? match.range.end - match.range.start : Number.POSITIVE_INFINITY
}

function shouldPreferOverlappingMatch(
  candidate: WorkflowSearchMatch,
  current: WorkflowSearchMatch
): boolean {
  const candidateLength = getRangeLength(candidate)
  const currentLength = getRangeLength(current)
  if (candidateLength !== currentLength) return candidateLength < currentLength

  const candidatePriority = OVERLAPPING_MATCH_KIND_PRIORITY[candidate.kind]
  const currentPriority = OVERLAPPING_MATCH_KIND_PRIORITY[current.kind]
  if (candidatePriority !== currentPriority) return candidatePriority > currentPriority

  return false
}

export function dedupeOverlappingWorkflowSearchMatches<T extends WorkflowSearchMatch>(
  matches: T[]
): T[] {
  const deduped: T[] = []

  for (const match of matches) {
    const scopeKey = getRangeMatchScopeKey(match)
    const matchRange = match.range
    const existingIndex =
      scopeKey && matchRange
        ? deduped.findIndex(
            (candidate) =>
              getRangeMatchScopeKey(candidate) === scopeKey &&
              candidate.range &&
              rangesOverlap(candidate.range, matchRange)
          )
        : -1

    if (existingIndex === -1) {
      deduped.push(match)
      continue
    }

    if (shouldPreferOverlappingMatch(match, deduped[existingIndex])) {
      deduped[existingIndex] = match
    }
  }

  return deduped
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
