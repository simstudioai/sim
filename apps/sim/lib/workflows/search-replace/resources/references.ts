import {
  getWorkflowSearchSubBlockResourceKind,
  parseWorkflowSearchSubBlockResources,
  type StructuredResourceReference,
} from '@/lib/workflows/search-replace/resources/registry'
import type {
  WorkflowSearchRange,
  WorkflowSearchResourceMeta,
} from '@/lib/workflows/search-replace/types'
import type { SubBlockConfig } from '@/blocks/types'
import { createEnvVarPattern, createReferencePattern } from '@/executor/utils/reference-validation'
import type { SelectorContext } from '@/hooks/selectors/types'

export interface ParsedInlineReference {
  kind: 'environment' | 'workflow-reference'
  rawValue: string
  searchText: string
  range: WorkflowSearchRange
  resource: WorkflowSearchResourceMeta
}

export function getResourceKindForSubBlock(
  subBlockConfig?: Pick<SubBlockConfig, 'type'>
): StructuredResourceReference['kind'] | null {
  return getWorkflowSearchSubBlockResourceKind(subBlockConfig)
}

export function parseInlineReferences(value: string): ParsedInlineReference[] {
  const references: ParsedInlineReference[] = []

  const envPattern = createEnvVarPattern()
  for (const match of value.matchAll(envPattern)) {
    const rawValue = match[0]
    const key = String(match[1] ?? '').trim()
    const start = match.index ?? 0
    references.push({
      kind: 'environment',
      rawValue,
      searchText: key,
      range: { start, end: start + rawValue.length },
      resource: {
        kind: 'environment',
        token: rawValue,
        key,
      },
    })
  }

  const referencePattern = createReferencePattern()
  for (const match of value.matchAll(referencePattern)) {
    const rawValue = match[0]
    const reference = String(match[1] ?? '').trim()
    const start = match.index ?? 0
    references.push({
      kind: 'workflow-reference',
      rawValue,
      searchText: reference,
      range: { start, end: start + rawValue.length },
      resource: {
        kind: 'workflow-reference',
        token: rawValue,
        key: reference,
      },
    })
  }

  return references.sort((a, b) => a.range.start - b.range.start)
}

export function parseStructuredResourceReferences(
  value: unknown,
  subBlockConfig?: Pick<SubBlockConfig, 'type' | 'serviceId' | 'selectorKey' | 'requiredScopes'>,
  selectorContext?: SelectorContext
): StructuredResourceReference[] {
  return parseWorkflowSearchSubBlockResources(value, subBlockConfig, selectorContext)
}

/**
 * Maps every Unicode whitespace character to a plain space, one-to-one.
 * Agent-authored block names and values routinely carry non-breaking or
 * narrow spaces that render identically to " " but never equal a typed
 * space, silently hiding matches. The replacement is length-preserving
 * (every `\s` character is a single UTF-16 unit), so indexes into the
 * folded string remain valid ranges into the original.
 */
export function foldSearchWhitespace(value: string): string {
  return value.replace(/\s/g, ' ')
}

export function matchesSearchText(
  candidate: string,
  query: string | undefined,
  caseSensitive = false
): boolean {
  if (!query) return true
  const foldedCandidate = foldSearchWhitespace(candidate)
  const foldedQuery = foldSearchWhitespace(query)
  const source = caseSensitive ? foldedCandidate : foldedCandidate.toLowerCase()
  const target = caseSensitive ? foldedQuery : foldedQuery.toLowerCase()
  return source.includes(target)
}
