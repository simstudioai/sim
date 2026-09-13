import {
  findWorkflowReferenceTokens,
  isLikelyWorkflowReferenceSegment,
  splitWorkflowReferenceSegment,
} from '@sim/utils/workflow-references'
import { normalizeName, REFERENCE } from '@/executor/constants'

export const SYSTEM_REFERENCE_PREFIXES = new Set(['loop', 'parallel', 'variable'])

export const splitReferenceSegment = splitWorkflowReferenceSegment
export const isLikelyReferenceSegment = isLikelyWorkflowReferenceSegment

/**
 * Whether a subblock value carries a `<block.path>` / `<variable.name>` reference or a
 * `{{ENV_VAR}}` placeholder instead of a literal value — i.e. its real value is only known
 * once the workflow runs. Conditions that gate one field on a sibling's literal value use
 * this to stay visible while the sibling is bound dynamically.
 */
export function containsReference(value: unknown): boolean {
  if (typeof value !== 'string' || !value) {
    return false
  }
  return findWorkflowReferenceTokens(value).length > 0
}

/**
 * Mark every `<...>` region that reads as a workflow reference, including one the tokenizer
 * dropped for overlapping an `{{ENV_VAR}}` token.
 *
 * `findWorkflowReferenceTokens` is contractually NON-overlapping, so for `<a.pick({{B}},c)>` it
 * reports only the inner `{{B}}` and discards the outer candidate. That is right for a tokenizer
 * and wrong for a splitter, which needs the UNION of protected regions rather than a disjoint set.
 */
function markCandidateReferenceRegions(value: string, insideReference: Uint8Array): void {
  let candidateStart = -1
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    if (character === REFERENCE.START && candidateStart === -1) {
      candidateStart = index
      continue
    }
    if (character === '\r' || character === '\n') {
      candidateStart = -1
      continue
    }
    if (character !== REFERENCE.END || candidateStart === -1) continue

    const candidate = value.slice(candidateStart, index + REFERENCE.END.length)
    const split = splitReferenceSegment(candidate)
    if (split && isLikelyReferenceSegment(candidate)) {
      const start = candidateStart + split.leading.length
      const end = Math.min(start + split.reference.length, value.length)
      for (let position = start; position < end; position += 1) {
        insideReference[position] = 1
      }
    }
    candidateStart = -1
  }
}

/**
 * Split a comma-separated multi-select value without tearing a reference apart.
 *
 * A `<block.path>` or `{{ENV_VAR}}` token may legitimately contain a comma (`<start.pick(a,b)>`),
 * and its fragments read as plain literals once split, so a naive `.split(',')` turns one dynamic
 * value into several bogus ones. Only commas outside every reference region are separators.
 */
export function splitOutsideReferences(value: string): string[] {
  const plainSplit = () =>
    value
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)

  if (!value.includes(REFERENCE.START) && !value.includes(REFERENCE.ENV_VAR_START)) {
    return plainSplit()
  }

  // Marked once up front rather than scanned per comma: a per-comma `tokens.some()` is
  // O(commas x tokens), which reached ~2.5s on a 240KB value of repeated `{{A}},`.
  const tokens = findWorkflowReferenceTokens(value)
  const insideReference = new Uint8Array(value.length)
  let hasEnvironmentToken = false
  for (const token of tokens) {
    if (token.kind === 'environment') hasEnvironmentToken = true
    const end = Math.min(token.end, value.length)
    for (let index = Math.max(token.start, 0); index < end; index += 1) {
      insideReference[index] = 1
    }
  }

  // Overlap with an environment token is the only reason the tokenizer drops a workflow
  // candidate, so without one it already reported every region and re-scanning is duplicate work.
  if (hasEnvironmentToken) {
    markCandidateReferenceRegions(value, insideReference)
  }

  const parts: string[] = []
  let partStart = 0
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === ',' && !insideReference[index]) {
      parts.push(value.slice(partStart, index))
      partStart = index + 1
    }
  }
  parts.push(value.slice(partStart))

  return parts.map((part) => part.trim()).filter(Boolean)
}

export function extractReferencePrefixes(value: string): Array<{ raw: string; prefix: string }> {
  if (!value || typeof value !== 'string') {
    return []
  }

  const references: Array<{ raw: string; prefix: string }> = []

  for (const token of findWorkflowReferenceTokens(value)) {
    if (token.kind !== 'workflow') continue
    const inner = token.value.slice(REFERENCE.START.length, -REFERENCE.END.length)
    const [rawPrefix] = inner.split(REFERENCE.PATH_DELIMITER)
    if (!rawPrefix) continue

    const normalized = normalizeName(rawPrefix)
    references.push({ raw: token.value, prefix: normalized })
  }

  return references
}
