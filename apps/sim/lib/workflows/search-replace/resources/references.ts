import { foldSearchWhitespace } from '@sim/utils/string'
import {
  getWorkflowSearchSubBlockResourceKind,
  parseWorkflowSearchSubBlockResources,
  type StructuredResourceReference,
} from '@/lib/workflows/search-replace/resources/registry'
import type {
  WorkflowSearchRange,
  WorkflowSearchResourceMeta,
  WorkflowSearchSelectorContext,
} from '@/lib/workflows/search-replace/types'
import type { SubBlockConfig } from '@/blocks/types'
import { normalizeName, REFERENCE } from '@/executor/constants'
import { createEnvVarPattern, createReferencePattern } from '@/executor/utils/reference-validation'

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

/**
 * Indexes a workflow's block names by the prefix their references carry, so a
 * parsed reference can be read back as the name the canvas shows.
 *
 * Creating or renaming a block enforces uniqueness at the normalized level, but
 * legacy workflows can still hold two names that collide only now that
 * `normalizeName` strips dots. `BlockResolver` settles that tie by letting the
 * dot-free name keep ownership of the key, so previously working references
 * never change targets; this mirrors that rule rather than taking whichever
 * block happens to be iterated last, so search names the block a reference
 * actually resolves to at execution time.
 *
 * Blank names are skipped rather than mapped to an empty prefix.
 */
export function buildBlockNamesByReferencePrefix(
  blocks: Record<string, { name?: string }>
): Map<string, string> {
  const namesByPrefix = new Map<string, string>()

  for (const block of Object.values(blocks)) {
    if (typeof block.name !== 'string') continue
    const prefix = normalizeName(block.name)
    if (!prefix) continue

    const incumbent = namesByPrefix.get(prefix)
    if (incumbent === undefined || incumbent.includes(REFERENCE.PATH_DELIMITER)) {
      namesByPrefix.set(prefix, block.name)
    }
  }

  return namesByPrefix
}

/**
 * Rewrites a block reference's search text into the name the block is shown
 * under, so searching reads the same as the canvas does.
 *
 * A reference stores its target as `normalizeName(block.name)` - lowercased with
 * whitespace and dots stripped - so a block headed "Send Email" is written
 * `<sendemail.content>`. Searching the two words the card shows found the block
 * itself but none of its references; only the run-together form found those.
 *
 * Only the prefix is rewritten. What follows it is the block's output path, not
 * a name. A prefix that names no block - a system prefix like `loop`, or a
 * reference left behind by a deleted block - is left exactly as written, and so
 * is an environment reference, whose search text is its key rather than a name.
 */
export function resolveInlineReferenceSearchText(
  reference: ParsedInlineReference,
  blockNamesByReferencePrefix: ReadonlyMap<string, string>
): string {
  if (reference.kind !== 'workflow-reference') return reference.searchText

  const delimiterIndex = reference.searchText.indexOf(REFERENCE.PATH_DELIMITER)
  const prefix =
    delimiterIndex === -1 ? reference.searchText : reference.searchText.slice(0, delimiterIndex)
  const blockName = blockNamesByReferencePrefix.get(normalizeName(prefix))
  if (!blockName || blockName === prefix) return reference.searchText

  return delimiterIndex === -1
    ? blockName
    : `${blockName}${reference.searchText.slice(delimiterIndex)}`
}

export function parseStructuredResourceReferences(
  value: unknown,
  subBlockConfig?: Pick<SubBlockConfig, 'type' | 'serviceId' | 'selectorKey' | 'requiredScopes'>,
  selectorContext?: WorkflowSearchSelectorContext
): StructuredResourceReference[] {
  return parseWorkflowSearchSubBlockResources(value, subBlockConfig, selectorContext)
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
