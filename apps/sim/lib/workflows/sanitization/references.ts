import {
  ENV_REFERENCE_PATTERN,
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
 * Mark every region of `value` that belongs to a reference, as a union rather than a partition.
 *
 * Deliberately does NOT use `findWorkflowReferenceTokens`. That returns contractually
 * non-overlapping tokens, which costs an O(tokens^2) overlap check and drops a `<...>` candidate
 * that wraps an `{{ENV_VAR}}` - both wrong here. A splitter only needs to know whether an index is
 * inside SOME reference, so scanning each kind independently is both cheaper and more accurate.
 */
function markReferenceRegions(value: string, insideReference: Uint8Array): void {
  const mark = (start: number, end: number) => {
    for (let index = Math.max(start, 0); index < Math.min(end, value.length); index += 1) {
      insideReference[index] = 1
    }
  }

  for (const match of value.matchAll(ENV_REFERENCE_PATTERN)) {
    mark(match.index, match.index + match[0].length)
  }

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
      mark(start, start + split.reference.length)
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
  if (!value.includes(REFERENCE.START) && !value.includes(REFERENCE.ENV_VAR_START)) {
    return value
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
  }

  const insideReference = new Uint8Array(value.length)
  markReferenceRegions(value, insideReference)

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
