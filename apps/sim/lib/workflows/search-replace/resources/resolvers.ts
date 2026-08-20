import { foldSearchWhitespace } from '@sim/utils/string'
import type {
  WorkflowSearchMatch,
  WorkflowSearchMatchKind,
  WorkflowSearchReplacementOption,
  WorkflowSearchResourceMeta,
  WorkflowSearchValuePath,
} from '@/lib/workflows/search-replace/types'

/**
 * Which kind wins when two matches cover the same span. Exported so the
 * equivalence tests can share it instead of hand-copying the values, which
 * silently drifted once already.
 */
export const OVERLAPPING_MATCH_KIND_PRIORITY: Record<WorkflowSearchMatchKind, number> = {
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

/** Kept indices for one overlap scope, plus an upper bound on their `range.end`. */
interface RangeMatchScopeBucket {
  indices: number[]
  maxEnd: number
}

function widenScopeBucket(bucket: RangeMatchScopeBucket, end: number): void {
  if (!Number.isNaN(end)) bucket.maxEnd = Math.max(bucket.maxEnd, end)
}

/**
 * Overlap resolution is scoped to one value inside one subblock, so candidates
 * are bucketed by that scope rather than rescanned. The previous `findIndex`
 * over the whole accumulated list recomputed every candidate's scope key on
 * every iteration - O(n^2) string builds, which cost ~1.4s on a workflow
 * producing ~500 matches and froze the search field while typing.
 *
 * A bucket only ever holds entries that have both a scope key and a range, and
 * those are exactly the entries the old predicate could match. Buckets keep
 * insertion order and the scan stops at the first overlap, so this picks the
 * same candidate the linear scan did.
 *
 * `maxEnd` is a monotonic high-water mark, not the exact current maximum: a
 * replacement can swap in a range that ends earlier without lowering it. Only
 * the upper bound is load-bearing. A match starting at or after it cannot
 * overlap anything in the bucket, so the scan is skipped; a bound left too high
 * only costs a scan that would have been skipped, never a wrong answer.
 *
 * Recomputing the exact maximum on every shrinking replacement is a net loss -
 * it walks the bucket, which is the cost this is here to avoid, and staleness
 * is capped at one token length because every range spans a matched token
 * (`query.length`, or a reference's `rawValue.length`) rather than the field.
 * Measured on the realistic overlap shape at 10k matches: 23ms as written,
 * 45ms with the recompute, against 1010ms for the scan this replaced.
 *
 * The bound keeps a field full of disjoint hits linear instead of quadratic
 * within its own bucket, to the extent its matches arrive in ascending offset
 * order; out-of-order producers just fall back to scanning.
 *
 * It must be refreshed on the replacement path too, not only on append:
 * `shouldPreferOverlappingMatch` prefers the SHORTER range, and a shorter range
 * can still end further right than the one it evicts. Leaving `maxEnd` stale
 * there let the short-circuit skip genuine overlaps and leak duplicates.
 *
 * Only `NaN` ends are ignored. `Math.max` with `NaN` would pin `maxEnd` at
 * `NaN`, and since every comparison against `NaN` is false that would silently
 * switch dedupe off for the rest of the scope. A `NaN`-ended range cannot
 * overlap anything anyway, while positive infinity is an unbounded end that
 * can overlap later ranges and therefore must widen the high-water mark.
 */
export function dedupeOverlappingWorkflowSearchMatches<T extends WorkflowSearchMatch>(
  matches: T[]
): T[] {
  const deduped: T[] = []
  const bucketsByScopeKey = new Map<string, RangeMatchScopeBucket>()

  for (const match of matches) {
    const scopeKey = getRangeMatchScopeKey(match)
    const matchRange = match.range
    const bucket = scopeKey && matchRange ? bucketsByScopeKey.get(scopeKey) : undefined

    let existingIndex = -1
    if (bucket && matchRange && matchRange.start < bucket.maxEnd) {
      for (const index of bucket.indices) {
        const candidate = deduped[index]
        if (candidate.range && rangesOverlap(candidate.range, matchRange)) {
          existingIndex = index
          break
        }
      }
    }

    if (existingIndex === -1) {
      if (scopeKey && matchRange) {
        if (bucket) {
          bucket.indices.push(deduped.length)
          widenScopeBucket(bucket, matchRange.end)
        } else {
          bucketsByScopeKey.set(scopeKey, {
            indices: [deduped.length],
            maxEnd: Number.isNaN(matchRange.end) ? Number.NEGATIVE_INFINITY : matchRange.end,
          })
        }
      }
      deduped.push(match)
      continue
    }

    if (shouldPreferOverlappingMatch(match, deduped[existingIndex])) {
      deduped[existingIndex] = match
      if (bucket && matchRange) widenScopeBucket(bucket, matchRange.end)
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

  const normalize = (value: string) => {
    const folded = foldSearchWhitespace(value)
    return caseSensitive ? folded : folded.toLowerCase()
  }
  const searchable =
    match.resource?.kind === 'workflow-reference' || match.resource?.kind === 'environment'
      ? [match.displayLabel, match.rawValue, match.searchText]
      : [match.displayLabel]
  const searchableText = searchable.filter(Boolean).join(' ')

  return normalize(searchableText).includes(normalize(trimmedQuery))
}
