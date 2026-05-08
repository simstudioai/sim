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

export function matchesSearchText(
  candidate: string,
  query: string | undefined,
  caseSensitive = false
): boolean {
  if (!query) return true
  const source = caseSensitive ? candidate : candidate.toLowerCase()
  const target = caseSensitive ? query : query.toLowerCase()
  return source.includes(target)
}
